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

/**
 * Depth-first search for the first text node whose content matches `pattern`,
 * mirroring BeautifulSoup's `soup.find(string=regex)`.
 */
function findTextNode(nodes: AnyNode[], pattern: RegExp): Text | null {
  for (const node of nodes) {
    if (isText(node) && pattern.test(node.data)) {
      return node;
    }
    const children = (node as Element).children;
    if (children && children.length) {
      const found = findTextNode(children, pattern);
      if (found) return found;
    }
  }
  return null;
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
    const text = $.root().text().replace(/\s+/g, " ").trim();
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
    return parentText || null;
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

// The only address original (non-forwarded) GrabExpress receipts are ever
// sent from — see CLAUDE.md and md files/grabexpress_receipts_raw.md.
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
 *
 * Extension point: future Grab receipt types (GrabFood, GrabCar, GrabMart)
 * should subclass BaseGrabReceiptParser the same way, without changing the
 * ReceiptParser contract callers rely on.
 */
export class GrabExpressReceiptParser extends BaseGrabReceiptParser {
  private static readonly BOOKING_CODE_LABEL = /booking\s*code/i;
  private static readonly AMOUNT_LABEL = /total(?:\s*(?:paid|amount|fare))?/i;
  private static readonly DATE_LABEL = /\bdate\b/i;

  // Grab booking codes look like "A-9GOVVE8GX938AV": a short letter prefix,
  // a dash, then an alphanumeric run.
  private static readonly BOOKING_CODE_RE = /\b[A-Z]-[A-Z0-9]{8,}\b/;
  // Cents are optional: Grab shows whole-ringgit totals as "RM 7", not "RM 7.00".
  // The RM/MYR currency prefix is optional here because this pattern is only
  // ever run against text already scoped to right next to the "Total" label
  // (see findValueNearLabel) — a bare number there is still trustworthy.
  private static readonly AMOUNT_RE = /(?:RM|MYR)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i;
  // Used only as the whole-document last-resort fallback when the label
  // can't be located at all. Unlike AMOUNT_RE above, the currency prefix is
  // REQUIRED here — without it, this would match the first bare digit run
  // anywhere in the email (tracking IDs, postal codes, booking code digits,
  // phone numbers...) and silently report a bogus amount instead of failing
  // loudly with "Amount not found".
  private static readonly AMOUNT_FALLBACK_RE = /(?:RM|MYR)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i;

  parse(html: string, messageId: string, fromHeader?: string | null): Receipt {
    const { $, text, hasForwardMarker } = this.load(html);

    const receiptNo = this.extractBookingCode($, text);
    const amount = this.extractAmount($, text);
    const date = this.extractDate($, text);
    const source = determineSource(fromHeader, hasForwardMarker);

    return { date, receiptNo, amount, source, messageId };
  }

  private extractBookingCode($: cheerio.CheerioAPI, text: string): string {
    const value = this.findValueNearLabel($, GrabExpressReceiptParser.BOOKING_CODE_LABEL);
    if (value) {
      const match = GrabExpressReceiptParser.BOOKING_CODE_RE.exec(value);
      if (match) return match[0];
      return value;
    }

    const match = GrabExpressReceiptParser.BOOKING_CODE_RE.exec(text);
    if (match) return match[0];

    throw new ReceiptParseError("Booking Code not found");
  }

  private extractAmount($: cheerio.CheerioAPI, text: string): number {
    const value = this.findValueNearLabel($, GrabExpressReceiptParser.AMOUNT_LABEL);
    if (value) {
      const match = GrabExpressReceiptParser.AMOUNT_RE.exec(value);
      if (match) return Number(match[1].replace(/,/g, ""));
    }

    const match = GrabExpressReceiptParser.AMOUNT_FALLBACK_RE.exec(text);
    if (match) return Number(match[1].replace(/,/g, ""));

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
 * Returns the parser for a receipt email subject. Only GrabExpress is
 * implemented; this is the extension point for GrabFood/GrabCar/GrabMart
 * parsers later.
 */
export function getParserForSubject(subject: string): ReceiptParser {
  if (subject.toLowerCase().includes("grabexpress")) {
    return new GrabExpressReceiptParser();
  }
  throw new ReceiptParseError(`No parser available for subject: "${subject}"`);
}

export function parseGrabExpressReceipt(html: string, messageId: string, fromHeader?: string | null): Receipt {
  return new GrabExpressReceiptParser().parse(html, messageId, fromHeader);
}
