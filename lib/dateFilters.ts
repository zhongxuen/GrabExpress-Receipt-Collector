import * as chrono from "chrono-node";
import type { GrabService } from "./types";

export type DateRangeMode = "all" | "since" | "month" | "custom" | "phrase";

export interface DateRangeInput {
  mode: DateRangeMode;
  since?: string; // YYYY-MM-DD
  month?: string; // YYYY-MM
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  phrase?: string;
}

/** POST body for /api/export and /api/demo-export: the date range plus an
 * optional service filter. `services` is untrusted, so routes run it through
 * parseServices rather than reading it directly. */
export interface ExportRequestBody extends DateRangeInput {
  services?: unknown;
}

export interface ResolvedDateRange {
  /** Gmail query fragment, e.g. "after:2026/06/01 before:2026/07/01". Empty string for all-time. */
  gmailQueryFragment: string;
  /** Suffix used in the exported filename, e.g. "2026", "June2026". Empty string for all-time. */
  filenameLabel: string;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function toGmailDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function toFilenameDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function rangeFragment(from: Date, to: Date | null): string {
  const parts = [`after:${toGmailDate(from)}`];
  if (to) parts.push(`before:${toGmailDate(to)}`);
  return parts.join(" ");
}

function parseYearMonth(monthStr: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseIsoDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Handles common phrases deterministically before falling back to chrono-node. */
function resolvePhrase(phrase: string, now: Date): ResolvedDateRange | null {
  const p = phrase.trim().toLowerCase();

  if (p === "" || p === "all" || p === "all time" || p === "all receipts") {
    return { gmailQueryFragment: "", filenameLabel: "" };
  }

  // "last N days"
  const lastNDays = /^last (\d+) days?$/.exec(p);
  if (lastNDays) {
    const n = Number(lastNDays[1]);
    const from = startOfDay(addDays(now, -n));
    return {
      gmailQueryFragment: rangeFragment(from, null),
      filenameLabel: `last${n}days`,
    };
  }

  if (p === "this month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      gmailQueryFragment: rangeFragment(from, null),
      filenameLabel: `${MONTH_NAMES[from.getMonth()][0].toUpperCase()}${MONTH_NAMES[from.getMonth()].slice(1)}${from.getFullYear()}`,
    };
  }

  if (p === "last month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    const label = MONTH_NAMES[from.getMonth()];
    return {
      gmailQueryFragment: rangeFragment(from, to),
      filenameLabel: `${label[0].toUpperCase()}${label.slice(1)}${from.getFullYear()}`,
    };
  }

  if (p === "this year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return {
      gmailQueryFragment: rangeFragment(from, null),
      filenameLabel: `${from.getFullYear()}`,
    };
  }

  if (p === "last year") {
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear(), 0, 1);
    return {
      gmailQueryFragment: rangeFragment(from, to),
      filenameLabel: `${from.getFullYear()}`,
    };
  }

  // bare 4-digit year, e.g. "2025"
  const yearOnly = /^(\d{4})$/.exec(p);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    return { gmailQueryFragment: rangeFragment(from, to), filenameLabel: `${year}` };
  }

  // "<month name> <year>", e.g. "june 2026"
  const monthYear = new RegExp(`^(${MONTH_NAMES.join("|")}) (\\d{4})$`).exec(p);
  if (monthYear) {
    const monthIndex = MONTH_NAMES.indexOf(monthYear[1]);
    const year = Number(monthYear[2]);
    const from = new Date(year, monthIndex, 1);
    const to = new Date(year, monthIndex + 1, 1);
    const label = MONTH_NAMES[monthIndex];
    return {
      gmailQueryFragment: rangeFragment(from, to),
      filenameLabel: `${label[0].toUpperCase()}${label.slice(1)}${year}`,
    };
  }

  // "since <date>"
  const since = /^since (.+)$/.exec(p);
  if (since) {
    const parsed = chrono.parseDate(since[1], now);
    if (parsed) {
      const from = startOfDay(parsed);
      return {
        gmailQueryFragment: rangeFragment(from, null),
        filenameLabel: `since${toFilenameDate(from)}`,
      };
    }
  }

  return null;
}

export function resolveDateRange(input: DateRangeInput, now: Date = new Date()): ResolvedDateRange {
  switch (input.mode) {
    case "all":
      return { gmailQueryFragment: "", filenameLabel: "" };

    case "since": {
      if (!input.since) throw new Error("Missing 'since' date");
      const from = parseIsoDate(input.since);
      if (!from) throw new Error(`Invalid 'since' date: ${input.since}`);
      return {
        gmailQueryFragment: rangeFragment(from, null),
        filenameLabel: `since${toFilenameDate(from)}`,
      };
    }

    case "month": {
      if (!input.month) throw new Error("Missing 'month'");
      const ym = parseYearMonth(input.month);
      if (!ym) throw new Error(`Invalid month: ${input.month}`);
      const from = new Date(ym.year, ym.month - 1, 1);
      const to = new Date(ym.year, ym.month, 1);
      const label = MONTH_NAMES[ym.month - 1];
      return {
        gmailQueryFragment: rangeFragment(from, to),
        filenameLabel: `${label[0].toUpperCase()}${label.slice(1)}${ym.year}`,
      };
    }

    case "custom": {
      if (!input.from) throw new Error("Missing 'from' date");
      const from = parseIsoDate(input.from);
      if (!from) throw new Error(`Invalid 'from' date: ${input.from}`);
      const to = input.to ? parseIsoDate(input.to) : null;
      // Gmail's before: is exclusive of that day, so bump by one day to make the
      // user-selected "to" date inclusive.
      const toExclusive = to ? addDays(to, 1) : null;
      const label = to
        ? `${toFilenameDate(from)}-${toFilenameDate(to)}`
        : `since${toFilenameDate(from)}`;
      return {
        gmailQueryFragment: rangeFragment(from, toExclusive),
        filenameLabel: label,
      };
    }

    case "phrase": {
      if (!input.phrase) throw new Error("Missing 'phrase'");
      const resolved = resolvePhrase(input.phrase, now);
      if (resolved) return resolved;

      // Fall back to chrono for anything else parseable as a single date,
      // treated as a "since" filter.
      const parsed = chrono.parseDate(input.phrase, now);
      if (parsed) {
        const from = startOfDay(parsed);
        return {
          gmailQueryFragment: rangeFragment(from, null),
          filenameLabel: `since${toFilenameDate(from)}`,
        };
      }

      throw new Error(`Could not understand date phrase: "${input.phrase}"`);
    }

    default:
      throw new Error(`Unknown date range mode: ${input.mode}`);
  }
}

export const ALL_GRAB_SERVICES: GrabService[] = ["express", "food", "transport"];

/** Validates the untrusted `services` field of an export request body.
 * Anything missing or malformed means "all services". */
export function parseServices(raw: unknown): GrabService[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return ALL_GRAB_SERVICES.filter((s) => raw.includes(s));
}

// Per-service Gmail clauses. GrabFood and rides share the subject "Your Grab
// E-Receipt", so they're told apart by Gmail full-text search on each
// template's headline. The parser still records the real service from the
// body, so a mis-match here can only drop a receipt, never mislabel one.
const SERVICE_CLAUSES: Record<GrabService, string> = {
  express: 'subject:"Your GrabExpress Receipt"',
  food: '(subject:"Your Grab E-Receipt" "enjoyed your food")',
  transport: '(subject:"Your Grab E-Receipt" "enjoyed your ride")',
};

// No `from:` filter: real GrabExpress receipts often reach the target mailbox
// forwarded by whoever booked the delivery, not sent directly by Grab, so
// filtering on sender silently excludes them. The subject phrases survive
// forwarding (Gmail just prepends "Fwd:"), so they're the reliable match.
export const GRAB_RECEIPT_SEARCH_BASE =
  '(subject:"Your GrabExpress Receipt" OR subject:"Your Grab E-Receipt")';

/** The search clause for a set of services. All (or none) selected means the
 * plain subject union, which also catches any E-Receipt variant whose
 * headline matches neither the food nor the ride phrase. */
function serviceClause(services: GrabService[] | undefined): string {
  const selected = ALL_GRAB_SERVICES.filter((s) => services?.includes(s));
  if (selected.length === 0 || selected.length === ALL_GRAB_SERVICES.length) {
    return GRAB_RECEIPT_SEARCH_BASE;
  }
  if (selected.length === 1) return SERVICE_CLAUSES[selected[0]];
  return `(${selected.map((s) => SERVICE_CLAUSES[s]).join(" OR ")})`;
}

export function buildGmailQuery(
  input: DateRangeInput,
  now: Date = new Date(),
  services?: GrabService[]
): {
  query: string;
  filenameLabel: string;
} {
  const { gmailQueryFragment, filenameLabel } = resolveDateRange(input, now);
  const base = serviceClause(services);
  const query = gmailQueryFragment ? `${base} ${gmailQueryFragment}` : base;
  return { query, filenameLabel };
}

/**
 * Human-readable date range for the spreadsheet's Summary sheet, derived
 * from the after:/before: bounds of a Gmail query. Gmail's `before:` is
 * exclusive, so the shown end date is the day before it.
 */
export function describeDateRange(query: string): string {
  const after = /after:(\d{4})\/(\d{2})\/(\d{2})/.exec(query);
  const before = /before:(\d{4})\/(\d{2})\/(\d{2})/.exec(query);
  const from = after ? `${after[1]}-${after[2]}-${after[3]}` : null;
  let to: string | null = null;
  if (before) {
    const end = new Date(Date.UTC(Number(before[1]), Number(before[2]) - 1, Number(before[3]) - 1));
    to = end.toISOString().slice(0, 10);
  }
  if (from && to) return `${from} to ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Up to ${to}`;
  return "All time";
}
