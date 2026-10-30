import type { Receipt, SpendLimitSummary } from "./types";

// Upper bound on what the UI will accept — anything larger is almost
// certainly a typo, and "no limit" is expressed by leaving the field empty.
const MAX_SPEND_LIMIT = 1_000_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Validates the untrusted `spendLimit` field of an export request body.
 * Returns the limit in RM, or undefined for "no limit". */
export function parseSpendLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SPEND_LIMIT) {
    throw new Error("Spend limit must be a positive amount in RM.");
  }
  return Math.round(value * 100) / 100;
}

/** e.g. 500 -> "lastRM500", 99.5 -> "lastRM99.50" — appended to the export filename. */
export function spendLimitFilenameLabel(limit: number): string {
  return `lastRM${Number.isInteger(limit) ? limit : limit.toFixed(2)}`;
}

const toCents = (amount: number) => Math.round(amount * 100);

/** A receipt plus when its email reached Gmail (epoch ms), used to order
 * same-day receipts and to decide when it's safe to stop fetching. */
export interface DatedReceipt {
  receipt: Receipt;
  receivedAt?: number;
}

export interface SpendLimitResult {
  kept: Receipt[];
  /** Total of `kept`, in RM. */
  total: number;
  /** The most recent receipt that didn't fit — every older receipt is
   * excluded too, since the selection is a contiguous most-recent window. */
  nextExcluded?: Receipt;
}

/**
 * Walks receipts newest-first (by the date printed on the receipt, then by
 * email arrival for same-day ties) and keeps them until the next one would
 * push the total over `limit`. Deliberately contiguous: a receipt that doesn't
 * fit ends the window rather than being skipped in favour of smaller, older
 * ones, so the result is always "everything since date X".
 */
export function applySpendLimit(receipts: DatedReceipt[], limit: number): SpendLimitResult {
  const sorted = [...receipts].sort(
    (a, b) =>
      b.receipt.date.localeCompare(a.receipt.date) || (b.receivedAt ?? 0) - (a.receivedAt ?? 0)
  );
  const limitCents = toCents(limit);
  const kept: Receipt[] = [];
  let totalCents = 0;

  for (const { receipt } of sorted) {
    const cents = toCents(receipt.amount);
    if (totalCents + cents > limitCents) {
      return { kept, total: totalCents / 100, nextExcluded: receipt };
    }
    kept.push(receipt);
    totalCents += cents;
  }
  return { kept, total: totalCents / 100 };
}

/** The limit outcome as recorded in the Summary sheet and sent to the UI. */
export function summarizeSpendLimit(limit: number, result: SpendLimitResult): SpendLimitSummary {
  const next = result.nextExcluded;
  return {
    limit,
    total: result.total,
    nextExcluded: next && { date: next.date, amount: next.amount, service: next.service },
  };
}

/**
 * Whether messages not yet fetched could still change the result. A receipt's
 * printed date is never later than the day its email arrived (forwarding only
 * delays arrival), and Gmail lists messages newest-arrival first — so once the
 * oldest fetched message arrived before the first excluded receipt's date,
 * every unfetched receipt is strictly older and falls outside the window.
 * The extra day of margin absorbs timezone differences between the receipt's
 * local date and Gmail's UTC timestamps.
 */
export function canStopFetching(result: SpendLimitResult, oldestReceivedAt: number | undefined): boolean {
  if (!result.nextExcluded || oldestReceivedAt === undefined) return false;
  const excludedDayStartUtc = Date.parse(`${result.nextExcluded.date}T00:00:00Z`);
  return oldestReceivedAt < excludedDayStartUtc - DAY_MS;
}
