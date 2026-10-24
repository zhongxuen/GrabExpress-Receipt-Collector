import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
import type { Receipt, ReceiptSource } from "./types";

export class ReceiptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptParseError";
  }
}

export interface ReceiptParser {
  /**
   * `fromHeader` is the outer Gmail message's "From" header, when available.
   * It's the primary signal for Original vs. Forwarded — the in-body forward
   * marker (if any) is only used as a fallback when the header is missing.
   */
  parse(html: string, messageId: string, fromHeader?: string | null): Receipt;
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

function isText(node: AnyNode): node is Text {
  return node.type === "text";
}

// Elements whose text is never visible receipt content. Real Grab emails
// carry large <style> blocks, and CSS text must not be able to satisfy a
// label search or the whole-document fallback regexes.
const NON_CONTENT_TAGS = new Set(["style", "script"]);

/**
 * Depth-first search for the first text node whose content matches `pattern`,
 * mirroring BeautifulSoup's `soup.find(string=regex)`.
 */
function findTextNode(nodes: AnyNode[], pattern: RegExp): Text | null {
  for (const node of nodes) {
    if (isText(node) && pattern.test(node.data)) {
      return node;
    }
    if (isElement(node) && NON_CONTENT_TAGS.has(node.name)) continue;
    const children = (node as Element).children;
    if (children && children.length) {
      const found = findTextNode(children, pattern);
      if (found) return found;
    }
  }
  return null;
}

/** All visible text nodes in document order (skipping <style>/<script>). */
function collectTextNodes(nodes: AnyNode[], out: Text[] = []): Text[] {
  for (const node of nodes) {
    if (isText(node)) {
      out.push(node);
    } else if (isElement(node) && !NON_CONTENT_TAGS.has(node.name)) {
      collectTextNodes(node.children as AnyNode[], out);
    }
  }
  return out;
}

function nextElementSibling(node: AnyNode): Element | null {
  let current: AnyNode | null = node.next;
  while (current && !isElement(current)) {
    current = current.next;
  }
  return current as Element | null;
}

// Matches Gmail/Outlook-style forwarded-message headers ("---------- Forwarded
// message ---------" / "-----Original Message-----"). Gmail puts this marker
// and the From/Date/Subject/To lines that follow it as sibling text/br nodes
// inside one wrapping element, alongside the quoted message body.
const FORWARD_HEADER_RE = /-{2,}\s*(?:forwarded message|original message)\s*-{2,}/i;

// Matches the header field lines that immediately follow a forward marker
// ("From:", "Date:", "Subject:", "To:", "Sent:", "Cc:"). Used to bound how far
// stripForwardedHeader walks so it never eats into the quoted body, which can
// share the same wrapping element as the header.
const FORWARD_HEADER_FIELD_RE = /^(from|date|subject|to|sent|cc)\s*:/i;

/**
 * Base plumbing shared by all Grab receipt-type parsers: finds the value
 * associated with a label by proximity in the DOM rather than fixed element
 * positions, so it tolerates minor layout drift in the source HTML.
 */
abstract class BaseGrabReceiptParser implements ReceiptParser {
  abstract parse(html: string, messageId: string, fromHeader?: string | null): Receipt;

  protected load(html: string): { $: cheerio.CheerioAPI; text: string; hasForwardMarker: boolean } {
    const $ = cheerio.load(html);
    const hasForwardMarker = this.stripForwardedHeader($);
    // Text nodes are joined with a space rather than via `$.root().text()`,
    // which concatenates adjacent block elements with no separator (e.g.
    // "<div>Booking ID: A-8VSM8JHGW3KHAV</div><div>Total Paid</div>" becomes
    // "...KHAVTotal Paid"), defeating the `\b` in the whole-text fallbacks.
    const root = $.root().get(0);
    const text = collectTextNodes((root?.children ?? []) as AnyNode[])
      .map((node) => node.data)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { $, text, hasForwardMarker };
  }

  /**
   * Removes a Gmail/Outlook forwarded-message header block, if present, so
   * its own "Date:"/"From:" lines can't be mistaken for the receipt's actual
   * label values (e.g. the forward timestamp winning over the delivery date).
   *
   * Only the marker line and the header field lines (From/Date/Subject/To/
   * Sent/Cc) directly following it are removed. The header and the quoted
   * receipt body are sometimes siblings inside the same wrapping element, so
   * removing that whole element (as opposed to just the header lines within
   * it) would delete the real Booking Code/Total/Date too.
   *
   * Walking is done one *line* at a time — a line ends at the next `<br>`,
   * or at the end of the marker's siblings — rather than node by node,
   * because a header field's value is often split across several sibling
   * nodes on the same line (e.g. Gmail renders "From: <strong>name</strong>
   * <span>email</span>"). Judging each node in isolation would see the
   * `<strong>`/`<span>` value nodes as "not a header field" and stop before
   * the header (including its own Date line) was fully removed.
   */
  private stripForwardedHeader($: cheerio.CheerioAPI): boolean {
    const root = $.root().get(0);
    if (!root) return false;

    const markerNode = findTextNode((root.children ?? []) as AnyNode[], FORWARD_HEADER_RE);
    if (!markerNode) return false;

    const toRemove: AnyNode[] = [markerNode];
    let current: AnyNode | null = markerNode.next;
    let lineNodes: AnyNode[] = [];
    let lineText = "";

    while (current) {
      if (isElement(current) && current.name === "br") {
        const trimmed = lineText.trim();
        if (trimmed && !FORWARD_HEADER_FIELD_RE.test(trimmed)) break;
        toRemove.push(...lineNodes, current);
        lineNodes = [];
        lineText = "";
        current = current.next;
        continue;
      }

      lineNodes.push(current);
      lineText += isText(current) ? current.data : $(current).text();
      current = current.next;
    }

    // A trailing line with no terminating <br> (the marker's siblings simply
    // ran out) is only removed if it still looks like a header field or is
    // blank — never assume it's safe just because it's the last sibling.
    const trailingTrimmed = lineText.trim();
    if (!trailingTrimmed || FORWARD_HEADER_FIELD_RE.test(trailingTrimmed)) {
      toRemove.push(...lineNodes);
    }

    $(toRemove).remove();
    return true;
  }

  protected findValueNearLabel(
    $: cheerio.CheerioAPI,
    labelPattern: RegExp
  ): string | null {
    const root = $.root().get(0);
    if (!root) return null;

    const labelNode = findTextNode((root.children ?? []) as AnyNode[], labelPattern);
    if (!labelNode || !labelNode.parent || !isElement(labelNode.parent)) return null;

    const container = labelNode.parent;

    // Handle "Booking Code: ABC123" in a single text node.
    const ownText = labelNode.data.trim();
    const stripped = ownText.replace(labelPattern, "").replace(/^[\s:]+|[\s:]+$/g, "");
    if (stripped) return stripped;

    // Handle "TOTAL <br> <span>RM 7</span>" — label and value share a container,
    // with the value as a later sibling of the label's own text node.
    let sibling = nextElementSibling(labelNode);
    while (sibling) {
      const siblingText = $(sibling).text().trim();
      if (siblingText) return siblingText;
      sibling = nextElementSibling(sibling);
    }

    // Otherwise look at sibling elements of the label's container (e.g. label
    // and value are each wrapped in their own element: "<span>Booking code</span>
    // <br> <span>value</span>").
    sibling = nextElementSibling(container);
    while (sibling) {
      const siblingText = $(sibling).text().trim();
      if (siblingText) return siblingText;
      sibling = nextElementSibling(sibling);
    }

    // Fall back to the parent's full text, minus the label itself.
    const parentText = $(container)
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .replace(labelPattern, "")
      .replace(/^[\s:]+|[\s:]+$/g, "");
    if (parentText) return parentText;

    // Last resort: the label sits alone in its own cell and the value is in
    // the next cell over, e.g. GrabFood's "<td><span>TOTAL (INCL. TAX)</span>
    // </td><td><span>RM 16.50</span></td>". Climb a few ancestors looking for
    // a non-empty next sibling.
    let ancestor: AnyNode | null = container.parent;
    for (let depth = 0; ancestor && isElement(ancestor) && depth < 2; depth++) {
      sibling = nextElementSibling(ancestor);
      while (sibling) {
        const siblingText = $(sibling).text().trim();
        if (siblingText) return siblingText;
        sibling = nextElementSibling(sibling);
      }
      ancestor = ancestor.parent;
    }
    return null;
  }

  /**
   * The full text of the table cell (or, failing that, the element) holding
   * a label. For layouts where the value shares a cell with the label but
   * isn't its direct sibling, e.g. GrabFood's "DATE | TIME<br> Pick-up time:
   * <span>23 Oct 26 09:57 +0800</span>".
   */
  protected findContainerText($: cheerio.CheerioAPI, labelPattern: RegExp): string | null {
    const root = $.root().get(0);
    if (!root) return null;

    const labelNode = findTextNode((root.children ?? []) as AnyNode[], labelPattern);
    if (!labelNode || !labelNode.parent || !isElement(labelNode.parent)) return null;

    const parent = $(labelNode.parent);
    const cell = parent.closest("td");
    const text = (cell.length ? cell : parent).text().replace(/\s+/g, " ").trim();
    return text || null;
  }

  /**
   * Tries each label in turn and returns the first nearby value matching
   * `valuePattern` (the whole match, or capture group 1 if present).
   */
  protected matchNearLabels($: cheerio.CheerioAPI, labels: RegExp[], valuePattern: RegExp): string | null {
    for (const label of labels) {
      const value = this.findValueNearLabel($, label);
      if (!value) continue;
      const match = valuePattern.exec(value);
      if (match) return match[1] ?? match[0];
    }
    return null;
  }
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Grab's actual production receipts show the date as "24 Jul 26" — a
// 2-digit year, not "24 Jul 2026" as originally assumed and tested against
// only a synthetic sample (see md files/grabexpress_receipts_raw.md for real
// examples). Without the last alternative below, every real receipt's date
// fails to parse and the whole message gets skipped as "Date not found".
// The 4-digit-year alternative is tried first, so it always wins when a full
// year is actually present.
const DATE_CANDIDATE_RE =
  /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4})|(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2})\b/;

function parseDateCandidate(raw: string): string | null {
  const match = DATE_CANDIDATE_RE.exec(raw);
  if (!match) return null;

  if (match[1] && match[2] && match[3]) {
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return null;
    return formatDate(Number(match[3]), month, Number(match[1]));
  }
  if (match[4] && match[5] && match[6]) {
    return formatDate(Number(match[4]), Number(match[5]), Number(match[6]));
  }
  if (match[7] && match[8] && match[9]) {
    // day/month/year (Grab's regional format, not month/day/year)
    return formatDate(Number(match[9]), Number(match[8]), Number(match[7]));
  }
  if (match[10] && match[11] && match[12]) {
    const month = MONTHS[match[11].toLowerCase()];
    if (!month) return null;
    // Grab's 2-digit year is always contemporary (20YY), never 19YY.
    return formatDate(2000 + Number(match[12]), month, Number(match[10]));
  }
  return null;
}

// Grab booking codes / booking IDs look like "A-9GOVVE8GX938AV": a short
// letter prefix, a dash, then an alphanumeric run. Shared by GrabExpress,
// GrabFood delivery, and rides (older ride IDs are shorter, e.g.
// "A-6VHNPT9WWG22", which still clears the {8,}).
const BOOKING_CODE_RE = /\b[A-Z]-[A-Z0-9]{8,}\b/;
// GrabFood dine-in receipts have no Booking code, only an Order ID like
// "001490848944-C8E1A6W2FB3AEN". Some merchant-delivered GrabFood orders
// (e.g. Domino's) also put this shape, with a 9-digit prefix, under the
// "Booking code" label.
const ORDER_ID_RE = /\b\d{6,}-[A-Z0-9]{8,}\b/;
// Cents are optional: Grab shows whole-ringgit totals as "RM 7", not "RM 7.00".
// The RM/MYR currency prefix is optional here because this pattern is only
// ever run against text already scoped to right next to the "Total" label
// (see findValueNearLabel) — a bare number there is still trustworthy.
const AMOUNT_RE = /(?:RM|MYR)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i;
// Used only as the whole-document last-resort fallback when the label
// can't be located at all. Unlike AMOUNT_RE above, the currency prefix is
// REQUIRED here — without it, this would match the first bare digit run
// anywhere in the email (tracking IDs, postal codes, booking code digits,
// phone numbers...) and silently report a bogus amount instead of failing
// loudly with "Amount not found".
const AMOUNT_FALLBACK_RE = /(?:RM|MYR)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

// The only address original (non-forwarded) Grab receipts are ever sent
// from — see CLAUDE.md and md files/grabexpress_receipts_raw.md.
const GRAB_SENDER_RE = /no-reply@grab\.com/i;

/**
 * Determines whether a receipt email is Original or Forwarded.
 *
 * The outer Gmail "From" header is the primary signal — it's the actual
 * envelope sender and can't be spoofed by the message body. It's only
 * unavailable when the caller couldn't fetch headers, in which case this
 * falls back to whether a forwarded-message marker was found in the body
 * (see stripForwardedHeader). Forwarded receipts are still parsed and
 * included, just flagged, per the project spec — they aren't excluded.
 */
function determineSource(fromHeader: string | null | undefined, hasForwardMarker: boolean): ReceiptSource {
  if (fromHeader) {
    return GRAB_SENDER_RE.test(fromHeader) ? "Original" : "Forwarded";
  }
  return hasForwardMarker ? "Forwarded" : "Original";
}

/**
 * Parses "Your GrabExpress Receipt" emails. GrabExpress emails don't expose a
 * separate invoice/receipt ID, so the Booking Code is used as the Receipt
 * Number per the project spec.
 */
export class GrabExpressReceiptParser extends BaseGrabReceiptParser {
  private static readonly BOOKING_CODE_LABEL = /booking\s*code/i;
  private static readonly AMOUNT_LABEL = /total(?:\s*(?:paid|amount|fare))?/i;
  private static readonly DATE_LABEL = /\bdate\b/i;

  parse(html: string, messageId: string, fromHeader?: string | null): Receipt {
    const { $, text, hasForwardMarker } = this.load(html);

    const receiptNo = this.extractBookingCode($, text);
    const amount = this.extractAmount($, text);
    const date = this.extractDate($, text);
    const source = determineSource(fromHeader, hasForwardMarker);

    return { date, receiptNo, amount, service: "GrabExpress", category: "express", source, messageId };
  }

  private extractBookingCode($: cheerio.CheerioAPI, text: string): string {
    const value = this.findValueNearLabel($, GrabExpressReceiptParser.BOOKING_CODE_LABEL);
    if (value) {
      const match = BOOKING_CODE_RE.exec(value);
      if (match) return match[0];
      return value;
    }

    const match = BOOKING_CODE_RE.exec(text);
    if (match) return match[0];

    throw new ReceiptParseError("Booking Code not found");
  }

  private extractAmount($: cheerio.CheerioAPI, text: string): number {
    const value = this.findValueNearLabel($, GrabExpressReceiptParser.AMOUNT_LABEL);
    if (value) {
      const match = AMOUNT_RE.exec(value);
      if (match) return parseAmount(match[1]);
    }

    const match = AMOUNT_FALLBACK_RE.exec(text);
    if (match) return parseAmount(match[1]);

    throw new ReceiptParseError("Amount not found");
  }

  private extractDate($: cheerio.CheerioAPI, text: string): string {
    const value = this.findValueNearLabel($, GrabExpressReceiptParser.DATE_LABEL);
    const candidates = value ? [value, text] : [text];

    for (const candidate of candidates) {
      const parsed = parseDateCandidate(candidate);
      if (parsed) return parsed;
    }

    throw new ReceiptParseError("Date not found");
  }
}

/**
 * Parses GrabFood "Your Grab E-Receipt" emails: both delivery orders
 * ("Vehicle type: GrabFood", "Booking code A-…", "Pick-up time: …") and
 * scan-to-order dine-in ("Type of order: Dine-in", "Order ID 0014…-C8…", no
 * Booking code). See md files/general-grab-receipts-plan.md templates A/B.
 */
export class GrabFoodReceiptParser extends BaseGrabReceiptParser {
  private static readonly BOOKING_CODE_LABEL = /booking\s*code/i;
  private static readonly ORDER_ID_LABEL = /order\s*id/i;
  // "TOTAL (INCL. TAX)" in the summary, then the bare header "TOTAL". Both
  // show the same amount; the anchored header pattern avoids "Subtotal".
  private static readonly AMOUNT_LABELS = [/total\s*\(incl\.?\s*tax\)/i, /^\s*total\s*$/i];
  // "DATE | TIME": the value shares the cell but isn't the label's sibling
  // (delivery adds a "Pick-up time:" prefix), so the whole cell is parsed.
  private static readonly DATE_LABEL = /date\s*\|\s*time/i;
  private static readonly VEHICLE_TYPE_LABEL = /^\s*vehicle\s*type\s*:?\s*$/i;
  private static readonly ORDER_TYPE_LABEL = /^\s*type\s*of\s*order\s*:?\s*$/i;
  private static readonly MERCHANT_LABELS = [/^\s*order\s*location\s*:?\s*$/i, /^\s*restaurant\s*:?\s*$/i];

  parse(html: string, messageId: string, fromHeader?: string | null): Receipt {
    const { $, text, hasForwardMarker } = this.load(html);

    const receiptNo = this.extractReceiptNo($, text);
    const amount = this.extractAmount($, text);
    const date = this.extractDate($, text);
    const service = this.extractService($);
    const merchant = this.extractMerchant($);
    const source = determineSource(fromHeader, hasForwardMarker);

    return { date, receiptNo, amount, service, category: "food", merchant, source, messageId };
  }

  private extractReceiptNo($: cheerio.CheerioAPI, text: string): string {
    const nearLabel =
      this.matchNearLabels($, [GrabFoodReceiptParser.BOOKING_CODE_LABEL], BOOKING_CODE_RE) ??
      this.matchNearLabels(
        $,
        [GrabFoodReceiptParser.BOOKING_CODE_LABEL, GrabFoodReceiptParser.ORDER_ID_LABEL],
        ORDER_ID_RE
      );
    if (nearLabel) return nearLabel;

    const match = BOOKING_CODE_RE.exec(text) ?? ORDER_ID_RE.exec(text);
    if (match) return match[0];

    throw new ReceiptParseError("Booking code / Order ID not found");
  }

  private extractAmount($: cheerio.CheerioAPI, text: string): number {
    const value = this.matchNearLabels($, GrabFoodReceiptParser.AMOUNT_LABELS, AMOUNT_RE);
    if (value) return parseAmount(value);

    const match = AMOUNT_FALLBACK_RE.exec(text);
    if (match) return parseAmount(match[1]);

    throw new ReceiptParseError("Amount not found");
  }

  private extractDate($: cheerio.CheerioAPI, text: string): string {
    const cellText = this.findContainerText($, GrabFoodReceiptParser.DATE_LABEL);
    const candidates = cellText ? [cellText, text] : [text];

    for (const candidate of candidates) {
      const parsed = parseDateCandidate(candidate);
      if (parsed) return parsed;
    }

    throw new ReceiptParseError("Date not found");
  }

  /** "GrabFood" for delivery (or whatever "Vehicle type" says, e.g. a
   * GrabMart order on the same template), "GrabFood (Dine-in)" for dine-in. */
  private extractService($: cheerio.CheerioAPI): string {
    const vehicleType = this.findValueNearLabel($, GrabFoodReceiptParser.VEHICLE_TYPE_LABEL);
    if (vehicleType) return vehicleType;

    const orderType = this.findValueNearLabel($, GrabFoodReceiptParser.ORDER_TYPE_LABEL);
    if (orderType) return `GrabFood (${orderType})`;

    return "GrabFood";
  }

  private extractMerchant($: cheerio.CheerioAPI): string | undefined {
    for (const label of GrabFoodReceiptParser.MERCHANT_LABELS) {
      const value = this.findValueNearLabel($, label);
      if (value) return value.replace(/\s+/g, " ");
    }
    return undefined;
  }
}

/**
 * Parses GrabCar ride "Your Grab E-Receipt" emails: a newer div-based layout
 * with inline "Booking ID: A-…" / "Picked up on 14 February 2026" text and a
 * two-cell "Total Paid | RM 18.30" row. See md files/general-grab-receipts-plan.md
 * template C.
 *
 * There's deliberately no `/\bdate\b/` label here: the template has no "Date"
 * label, and the footer's "© Grab 2026" is a trap for loose matching.
 */
// Trip stop times in the ride "Your Trip" section, e.g. "11:58AM".
const TIME_RE = /^\d{1,2}:\d{2}\s*[AP]M$/i;

export class GrabTransportReceiptParser extends BaseGrabReceiptParser {
  private static readonly BOOKING_ID_LABEL = /booking\s*id/i;
  private static readonly AMOUNT_LABEL = /^\s*total\s*paid\s*$/i;
  private static readonly DATE_LABEL = /picked\s*up\s*on/i;
  private static readonly HEADLINE_RE = /enjoyed\s+your\s+ride/i;
  private static readonly TRIP_HEADING_RE = /^your\s+trip$/i;
  private static readonly PICKUP_ICON_RE = /^pick-?\s*up$/i;
  private static readonly DROPOFF_ICON_RE = /^drop-?\s*off$/i;

  parse(html: string, messageId: string, fromHeader?: string | null): Receipt {
    const { $, text, hasForwardMarker } = this.load(html);

    const receiptNo = this.extractBookingId($, text);
    const amount = this.extractAmount($, text);
    const date = this.extractDate($, text);
    const service = this.extractService($);
    const source = determineSource(fromHeader, hasForwardMarker);
    const { pickup, dropoff } = this.extractTrip($);

    return { date, receiptNo, amount, service, category: "transport", pickup, dropoff, source, messageId };
  }

  /**
   * Pickup/drop-off from the "Your Trip" section. Each stop is a table row
   * whose first cell holds an icon (`alt="pick-up"` / `alt="drop-off"`) and
   * whose next cell holds the location followed by a time ("11:58AM").
   * Optional: a receipt without a readable trip section still exports.
   */
  private extractTrip($: cheerio.CheerioAPI): { pickup?: string; dropoff?: string } {
    const pickup = this.findTripStop($, GrabTransportReceiptParser.PICKUP_ICON_RE);
    const dropoff = this.findTripStop($, GrabTransportReceiptParser.DROPOFF_ICON_RE);
    if (pickup && dropoff) return { pickup, dropoff };

    // Fallback without the icons: after the "Your Trip" heading, each
    // location is the line immediately before a time line.
    const root = $.root().get(0);
    const lines = collectTextNodes((root?.children ?? []) as AnyNode[])
      .map((node) => node.data.replace(/\s+/g, " ").trim())
      .filter((line) => line && line !== "⋮");
    const start = lines.findIndex((line) => GrabTransportReceiptParser.TRIP_HEADING_RE.test(line));
    const stops: string[] = [];
    if (start >= 0) {
      for (let i = start + 2; i < lines.length && stops.length < 2; i++) {
        if (TIME_RE.test(lines[i]) && !TIME_RE.test(lines[i - 1])) stops.push(lines[i - 1]);
      }
    }

    return { pickup: pickup ?? stops[0], dropoff: dropoff ?? stops[1] };
  }

  private findTripStop($: cheerio.CheerioAPI, iconAlt: RegExp): string | undefined {
    const icon = $("img")
      .filter((_, el) => iconAlt.test($(el).attr("alt") ?? ""))
      .first();
    if (!icon.length) return undefined;

    const iconCell = icon.closest("td");
    const detailCell = iconCell.nextAll("td").first();
    if (!detailCell.length) return undefined;

    const location = collectTextNodes(detailCell.get().flatMap((el) => el.children as AnyNode[]))
      .map((node) => node.data.replace(/\s+/g, " ").trim())
      .filter((line) => line && !TIME_RE.test(line))
      .join(" ");
    return location || undefined;
  }

  private extractBookingId($: cheerio.CheerioAPI, text: string): string {
    const value = this.matchNearLabels($, [GrabTransportReceiptParser.BOOKING_ID_LABEL], BOOKING_CODE_RE);
    if (value) return value;

    const match = BOOKING_CODE_RE.exec(text);
    if (match) return match[0];

    throw new ReceiptParseError("Booking ID not found");
  }

  private extractAmount($: cheerio.CheerioAPI, text: string): number {
    // The first "Total Paid" is the headline "RM 18.30"; a second one in the
    // fare breakdown repeats the number without the currency.
    const value = this.matchNearLabels($, [GrabTransportReceiptParser.AMOUNT_LABEL], AMOUNT_RE);
    if (value) return parseAmount(value);

    const match = AMOUNT_FALLBACK_RE.exec(text);
    if (match) return parseAmount(match[1]);

    throw new ReceiptParseError("Amount not found");
  }

  private extractDate($: cheerio.CheerioAPI, text: string): string {
    const value = this.findValueNearLabel($, GrabTransportReceiptParser.DATE_LABEL);
    if (value) {
      const parsed = parseDateCandidate(value);
      if (parsed) return parsed;
    }

    // Whole-text fallback, still anchored on "Picked up on" so the footer's
    // copyright year can't be picked up instead.
    const anchored = /picked\s*up\s*on\s+(.{1,40})/i.exec(text);
    const parsed = anchored ? parseDateCandidate(anchored[1]) : null;
    if (parsed) return parsed;

    throw new ReceiptParseError("Date not found");
  }

  /**
   * The ride product ("Standard (JustGrab)", "JustGrab", "Standard |
   * Top-Rated Drivers") is the short unlabelled line just above the "Hope you
   * enjoyed your ride!" headline. Falls back to plain "GrabCar".
   */
  private extractService($: cheerio.CheerioAPI): string {
    const root = $.root().get(0);
    const lines = collectTextNodes((root?.children ?? []) as AnyNode[])
      .map((node) => node.data.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const headlineIndex = lines.findIndex((line) => GrabTransportReceiptParser.HEADLINE_RE.test(line));
    const rideType = headlineIndex > 0 ? lines[headlineIndex - 1] : null;
    if (!rideType || rideType.length > 60) return "GrabCar";

    return /^grab/i.test(rideType) ? rideType : `GrabCar – ${rideType}`;
  }
}

// Body signatures used to pick a parser. Food and rides share the subject
// "Your Grab E-Receipt", so the body is what actually decides.
const RIDE_SIGNATURE_RE = /enjoyed\s+your\s+ride|booking\s*id\s*:[\s\S]*picked\s*up\s*on/i;
const FOOD_HEADLINE_RE = /enjoyed\s+your\s+food/i;
const FOOD_LABEL_RE = /vehicle\s*type\s*:|type\s*of\s*order\s*:/i;
const EXPRESS_HEADLINE_RE = /your\s+item\s+has\s+been\s+delivered/i;

/**
 * Picks the parser for a Grab receipt email.
 *
 * The subject only narrows the choice: "GrabExpress" goes straight to the
 * GrabExpress parser, while "Grab E-Receipt" covers both food and rides, so
 * the body is sniffed. Forwarded mail still works since a "Fwd:" subject
 * keeps the phrase. Unknown layouts throw, so a new variant (GrabMart,
 * GrabBike, …) shows up in the skipped list instead of being misparsed.
 */
export function getParserFor(html: string, subject?: string | null): ReceiptParser {
  const subjectLower = subject?.toLowerCase() ?? "";

  if (subjectLower.includes("grabexpress")) {
    return new GrabExpressReceiptParser();
  }

  if (RIDE_SIGNATURE_RE.test(html)) return new GrabTransportReceiptParser();
  if (FOOD_HEADLINE_RE.test(html)) return new GrabFoodReceiptParser();

  if (subjectLower.includes("grab e-receipt")) {
    if (FOOD_LABEL_RE.test(html)) return new GrabFoodReceiptParser();
    throw new ReceiptParseError("Unrecognised Grab E-Receipt layout");
  }

  // No usable subject (headers missing): rely on the body alone. The
  // GrabExpress headline is checked before the food labels because
  // GrabExpress receipts also carry a "Vehicle type" field.
  if (EXPRESS_HEADLINE_RE.test(html)) return new GrabExpressReceiptParser();
  if (FOOD_LABEL_RE.test(html)) return new GrabFoodReceiptParser();

  throw new ReceiptParseError("Unrecognised Grab receipt layout");
}

export function parseGrabReceipt(
  html: string,
  messageId: string,
  fromHeader?: string | null,
  subject?: string | null
): Receipt {
  return getParserFor(html, subject).parse(html, messageId, fromHeader);
}
