import type { ManualEntry, Receipt } from "./types";

// Grab only emails some GrabPay payments ("You've made a payment to …" —
// mostly online checkouts). QR / in-store payments and some payment-gateway
// merchants show up in the app's Activity History → Finance with no email at
// all, so Gmail can never find them. Manual entries let the user fill those
// gaps; they flow through the same spend limit / export as parsed receipts.

const MAX_ENTRIES = 500;
const MAX_MERCHANT_LENGTH = 120;
const MAX_AMOUNT = 100_000;

/** Shown in the Service column so manual rows get their own Summary line. */
export const MANUAL_SERVICE_LABEL = "GrabPay (no email)";

function isRealIsoDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.toISOString().slice(0, 10) === date;
}

/** Validates the untrusted `manualEntries` field of an export request body.
 * Missing means none; anything malformed is rejected rather than dropped, so
 * the user never silently loses a payment they typed in. */
export function parseManualEntries(raw: unknown): ManualEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("Manual entries must be a list.");
  if (raw.length > MAX_ENTRIES) throw new Error(`At most ${MAX_ENTRIES} manual entries are allowed.`);

  return raw.map((item, i) => {
    const n = i + 1;
    const entry = (item ?? {}) as Record<string, unknown>;
    const date = typeof entry.date === "string" ? entry.date.trim() : "";
    const merchant = typeof entry.merchant === "string" ? entry.merchant.trim() : "";
    const amount = typeof entry.amount === "string" ? Number(entry.amount) : entry.amount;

    if (!isRealIsoDate(date)) throw new Error(`Manual entry ${n}: invalid date.`);
    if (!merchant || merchant.length > MAX_MERCHANT_LENGTH) {
      throw new Error(`Manual entry ${n}: merchant is required (max ${MAX_MERCHANT_LENGTH} characters).`);
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      throw new Error(`Manual entry ${n}: amount must be a positive RM amount.`);
    }
    return { date, merchant, amount: Math.round(amount * 100) / 100 };
  });
}

/** Converts manual entries to receipts. Receipt Number stays blank — the app
 * shows no Transaction ID for these — and messageId is a synthetic key. */
export function manualEntriesToReceipts(entries: ManualEntry[]): Receipt[] {
  return entries.map((entry, i) => ({
    date: entry.date,
    receiptNo: "",
    amount: entry.amount,
    service: MANUAL_SERVICE_LABEL,
    category: "payment",
    merchant: entry.merchant,
    source: "Manual",
    messageId: `manual-${i + 1}`,
  }));
}
