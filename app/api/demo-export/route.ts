import { NextRequest, NextResponse } from "next/server";
import { buildGmailQuery, DateRangeInput } from "@/lib/dateFilters";
import { parseGrabExpressReceipt, ReceiptParseError } from "@/lib/receiptParser";
import { buildReceiptWorkbook } from "@/lib/exporter";
import { demoFixtures } from "@/lib/demoFixtures";
import { checkRateLimit } from "@/lib/rateLimit";
import type { Receipt, SkippedMessage } from "@/lib/types";

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

  let dateRangeInput: DateRangeInput;
  try {
    dateRangeInput = (await req.json()) as DateRangeInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let query: string;
  try {
    ({ query } = buildGmailQuery(dateRangeInput));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid date range";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { after, before } = parseDateBounds(query);
  const found = demoFixtures.filter((fixture) => {
    const messageDate = new Date(`${fixture.date}T00:00:00`);
    if (after && messageDate < after) return false;
    if (before && messageDate >= before) return false;
    return true;
  });

  const receipts: Receipt[] = [];
  const skipped: SkippedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenBookingCodes = new Set<string>();

  for (const message of found) {
    let receipt: Receipt;
    try {
      receipt = parseGrabExpressReceipt(message.html, message.messageId, message.fromHeader);
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

  const buffer = await buildReceiptWorkbook(receipts);
  // Fixed filename (never the real export's name) so a downloads folder can
  // never confuse a demo file for a real one.
  const filename = "grabexpress_receipts_demo.xlsx";

  const meta = {
    totalFound: found.length,
    exported: receipts.length,
    skipped,
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
