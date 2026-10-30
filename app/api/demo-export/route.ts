import { NextRequest, NextResponse } from "next/server";
import { ALL_GRAB_SERVICES, buildGmailQuery, describeDateRange, parseServices, type ExportRequestBody } from "@/lib/dateFilters";
import { parseGrabReceipt, ReceiptParseError } from "@/lib/receiptParser";
import { buildReceiptWorkbook, countByService } from "@/lib/exporter";
import { demoFixtures } from "@/lib/demoFixtures";
import { checkRateLimit } from "@/lib/rateLimit";
import { applySpendLimit, parseSpendLimit, summarizeSpendLimit } from "@/lib/spendLimit";
import type { ExportMeta, Receipt, SkippedMessage } from "@/lib/types";

// Publicly callable — no session/auth check. Sources fixture HTML instead of
// the Gmail API, but otherwise runs the exact same parse -> dedupe -> export
// pipeline as /api/export so the demo is proving the real pipeline works.
export const runtime = "nodejs";
export const maxDuration = 30;

/** Pulls the after:/before: bounds back out of the Gmail query fragment
 * buildGmailQuery() produces, so the same date-range logic used for the real
 * Gmail search can filter the in-memory fixture list instead. Gmail query
 * syntax itself is irrelevant here — fixtures never touch the Gmail API. */
function parseDateBounds(query: string): { after: Date | null; before: Date | null } {
  const afterMatch = /after:(\d{4})\/(\d{2})\/(\d{2})/.exec(query);
  const beforeMatch = /before:(\d{4})\/(\d{2})\/(\d{2})/.exec(query);
  const after = afterMatch
    ? new Date(Number(afterMatch[1]), Number(afterMatch[2]) - 1, Number(afterMatch[3]))
    : null;
  const before = beforeMatch
    ? new Date(Number(beforeMatch[1]), Number(beforeMatch[2]) - 1, Number(beforeMatch[3]))
    : null;
  return { after, before };
}

function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(clientIp(req));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many demo requests. Please wait a bit and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: ExportRequestBody;
  try {
    body = (await req.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let query: string;
  let spendLimit: number | undefined;
  try {
    ({ query } = buildGmailQuery(body));
    spendLimit = parseSpendLimit(body.spendLimit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid date range";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Same "nothing selected means everything" rule buildGmailQuery applies.
  const requested = parseServices(body.services);
  const services = requested?.length ? requested : ALL_GRAB_SERVICES;

  const { after, before } = parseDateBounds(query);
  const found = demoFixtures.filter((fixture) => {
    if (!services.includes(fixture.category)) return false;
    const messageDate = new Date(`${fixture.date}T00:00:00`);
    if (after && messageDate < after) return false;
    if (before && messageDate >= before) return false;
    return true;
  });

  let receipts: Receipt[] = [];
  const skipped: SkippedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenBookingCodes = new Set<string>();

  for (const message of found) {
    let receipt: Receipt;
    try {
      receipt = parseGrabReceipt(message.html, message.messageId, {
        fromHeader: message.fromHeader,
        subject: message.subject,
        // Stand-in for Gmail's arrival time: midday Malaysian time on the
        // fixture's date. Only GrabPay payments (no date in the body) use it.
        receivedAt: Date.parse(`${message.date}T12:00:00+08:00`),
      });
    } catch (err) {
      const reason = err instanceof ReceiptParseError ? err.message : "Unexpected error while processing message";
      skipped.push({ messageId: message.messageId, reason });
      continue;
    }
    if (seenMessageIds.has(receipt.messageId) || seenBookingCodes.has(receipt.receiptNo)) {
      continue; // duplicate, not a failure — silently deduped per spec
    }
    seenMessageIds.add(receipt.messageId);
    seenBookingCodes.add(receipt.receiptNo);
    receipts.push(receipt);
  }

  // Fixtures have no Gmail arrival time; their receipt dates alone order them.
  const limitResult =
    spendLimit !== undefined ? applySpendLimit(receipts.map((receipt) => ({ receipt })), spendLimit) : undefined;
  if (limitResult) receipts = limitResult.kept;
  const spendLimitSummary =
    spendLimit !== undefined && limitResult ? summarizeSpendLimit(spendLimit, limitResult) : undefined;

  const buffer = await buildReceiptWorkbook(receipts, {
    rangeLabel: describeDateRange(query),
    isDemo: true,
    skippedCount: skipped.length,
    spendLimit: spendLimitSummary,
  });
  // Fixed filename (never the real export's name) so a downloads folder can
  // never confuse a demo file for a real one.
  const filename = "grab_receipts_demo.xlsx";

  const meta: ExportMeta = {
    totalFound: found.length,
    exported: receipts.length,
    byService: countByService(receipts),
    skipped,
    spendLimit: spendLimitSummary,
  };

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Export-Meta": encodeURIComponent(JSON.stringify(meta)),
      "Access-Control-Expose-Headers": "X-Export-Meta",
    },
  });
}
