import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
import type { Receipt } from "./types";

export class ReceiptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptParseError";
  }
}

export interface ReceiptParser {
  parse(html: string, messageId: string): Receipt;
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

/**
 * Base plumbing shared by all Grab receipt-type parsers: finds the value
 * associated with a label by proximity in the DOM rather than fixed element
 * positions, so it tolerates minor layout drift in the source HTML.
 */
abstract class BaseGrabReceiptParser implements ReceiptParser {
  abstract parse(html: string, messageId: string): Receipt;

  protected load(html: string): { $: cheerio.CheerioAPI; text: string } {
    const $ = cheerio.load(html);
    const text = $.root().text().replace(/\s+/g, " ").trim();
    return { $, text };
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

    // Otherwise look at sibling elements of the label's container.
    let sibling = nextElementSibling(container);
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

const DATE_CANDIDATE_RE =
  /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;

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
  return null;
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
  private static readonly AMOUNT_RE = /(?:RM|MYR)?\s*([0-9]+(?:,[0-9]{3})*\.[0-9]{2})/i;

  parse(html: string, messageId: string): Receipt {
    const { $, text } = this.load(html);

    const receiptNo = this.extractBookingCode($, text);
    const amount = this.extractAmount($, text);
    const date = this.extractDate($, text);

    return { date, receiptNo, amount, messageId };
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

    const match = GrabExpressReceiptParser.AMOUNT_RE.exec(text);
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

export function parseGrabExpressReceipt(html: string, messageId: string): Receipt {
  return new GrabExpressReceiptParser().parse(html, messageId);
}
