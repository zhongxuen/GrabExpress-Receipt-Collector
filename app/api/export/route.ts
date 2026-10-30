import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  buildGmailQuery,
  describeDateRange,
  isWithinQueryRange,
  parseServices,
  type ExportRequestBody,
} from "@/lib/dateFilters";
import { searchMessages, fetchMessageContent, getAuthenticatedEmail } from "@/lib/gmailClient";
import { parseGrabReceipt, ReceiptParseError } from "@/lib/receiptParser";
import { buildReceiptWorkbook, countByService } from "@/lib/exporter";
import { mapWithConcurrency } from "@/lib/concurrency";
import { manualEntriesToReceipts, parseManualEntries } from "@/lib/manualEntries";
import {
  applySpendLimit,
  canStopFetching,
  parseSpendLimit,
  spendLimitFilenameLabel,
  summarizeSpendLimit,
  type DatedReceipt,
} from "@/lib/spendLimit";
import type { ExportMeta, Receipt, SkippedMessage } from "@/lib/types";

export const runtime = "nodejs";
// GrabFood/ride receipts push a typical mailbox from a handful of matches to
// hundreds, so this is well above what a GrabExpress-only export needed.
export const maxDuration = 300;

// Gmail messages are fetched in parallel batches of this size rather than
// one at a time — sequential fetches don't scale to large mailboxes and
// risk exceeding maxDuration above.
const FETCH_CONCURRENCY = 8;

// With a spend limit, messages are fetched newest-first in batches of this
// size, checking after each batch whether the rest can be skipped.
const SPEND_LIMIT_BATCH_SIZE = FETCH_CONCURRENCY * 3;

type MessageOutcome =
  | { kind: "receipt"; receipt: Receipt; receivedAt?: number }
  | { kind: "skipped"; skipped: SkippedMessage; receivedAt?: number };

async function processMessage(accessToken: string, messageId: string): Promise<MessageOutcome> {
  let receivedAt: number | undefined;
  try {
    const content = await fetchMessageContent(accessToken, messageId);
    receivedAt = content.receivedAt;
    if (!content.html) {
      return { kind: "skipped", skipped: { messageId, reason: "No HTML body found in message" }, receivedAt };
    }
    const receipt = parseGrabReceipt(content.html, messageId, {
      fromHeader: content.fromHeader,
      subject: content.subject,
      receivedAt: content.receivedAt,
      dateHeader: content.dateHeader,
    });
    return { kind: "receipt", receipt, receivedAt };
  } catch (err) {
    const reason =
      err instanceof ReceiptParseError
        ? err.message
        : err instanceof Error
          ? `Gmail API error: ${err.message}`
          : "Unexpected error while processing message";
    console.error(`[export] Skipped message ${messageId}: ${reason}`);
    return { kind: "skipped", skipped: { messageId, reason }, receivedAt };
  }
}

/** Splits outcomes into receipts and skips, dropping duplicates (same Message
 * ID or Booking Code) — duplicates aren't failures, so they're dropped silently. */
function collectOutcomes(outcomes: MessageOutcome[]): { receipts: DatedReceipt[]; skipped: SkippedMessage[] } {
  const receipts: DatedReceipt[] = [];
  const skipped: SkippedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenBookingCodes = new Set<string>();

  for (const outcome of outcomes) {
    if (outcome.kind === "skipped") {
      skipped.push(outcome.skipped);
      continue;
    }
    const { receipt, receivedAt } = outcome;
    if (seenMessageIds.has(receipt.messageId) || seenBookingCodes.has(receipt.receiptNo)) continue;
    seenMessageIds.add(receipt.messageId);
    seenBookingCodes.add(receipt.receiptNo);
    receipts.push({ receipt, receivedAt });
  }
  return { receipts, skipped };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not signed in. Please sign in with Google and try again." },
      { status: 401 }
    );
  }
  if (session.error === "RefreshAccessTokenError" || session.error === "MissingRefreshToken") {
    return NextResponse.json(
      { error: "Your Google session has expired. Please sign in again." },
      { status: 401 }
    );
  }

  let body: ExportRequestBody;
  try {
    body = (await req.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let query: string;
  let filenameLabel: string;
  let spendLimit: number | undefined;
  let manualReceipts: DatedReceipt[];
  try {
    const services = parseServices(body.services);
    ({ query, filenameLabel } = buildGmailQuery(body, new Date(), services));
    spendLimit = parseSpendLimit(body.spendLimit);
    // Manual entries skip the Gmail search, so apply its date range and the
    // GrabPay service filter here. Midday Malaysian time stands in for the
    // arrival time used to order same-day receipts under a spend limit.
    const includePayments = !services?.length || services.includes("payment");
    manualReceipts = manualEntriesToReceipts(parseManualEntries(body.manualEntries))
      .filter((receipt) => includePayments && isWithinQueryRange(receipt.date, query))
      .map((receipt) => ({ receipt, receivedAt: Date.parse(`${receipt.date}T12:00:00+08:00`) }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid date range";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const authenticatedEmail = await getAuthenticatedEmail(session.accessToken).catch(() => undefined);
  console.log(`[export] Authenticated as ${authenticatedEmail ?? "(unknown)"}; query: ${query}`);

  let found;
  try {
    found = await searchMessages(session.accessToken, query);
  } catch (err) {
    console.error("[export] Gmail search failed:", err);
    return NextResponse.json(
      { error: "Gmail search failed. This may be a rate limit or a temporary API error — please try again." },
      { status: 502 }
    );
  }

  console.log(`[export] Found ${found.length} matching message(s)`);

  const accessToken = session.accessToken;
  const outcomes: MessageOutcome[] = [];

  if (spendLimit === undefined) {
    outcomes.push(
      ...(await mapWithConcurrency(found, FETCH_CONCURRENCY, ({ messageId }) => processMessage(accessToken, messageId)))
    );
  } else {
    // Gmail lists newest-arrival first, so fetch from the top and stop once
    // canStopFetching proves the remaining (older) messages can't matter.
    for (let offset = 0; offset < found.length; offset += SPEND_LIMIT_BATCH_SIZE) {
      const batch = found.slice(offset, offset + SPEND_LIMIT_BATCH_SIZE);
      outcomes.push(
        ...(await mapWithConcurrency(batch, FETCH_CONCURRENCY, ({ messageId }) => processMessage(accessToken, messageId)))
      );
      const partial = applySpendLimit([...collectOutcomes(outcomes).receipts, ...manualReceipts], spendLimit);
      const arrivals = outcomes.map((o) => o.receivedAt).filter((t): t is number => t !== undefined);
      const oldestReceivedAt = arrivals.length ? Math.min(...arrivals) : undefined;
      if (canStopFetching(partial, oldestReceivedAt)) break;
    }
    console.log(`[export] Spend limit RM${spendLimit}: fetched ${outcomes.length} of ${found.length} message(s)`);
  }

  const collected = collectOutcomes(outcomes);
  const skipped = collected.skipped;
  const allReceipts = [...collected.receipts, ...manualReceipts];
  const limitResult = spendLimit !== undefined ? applySpendLimit(allReceipts, spendLimit) : undefined;
  const receipts: Receipt[] = limitResult ? limitResult.kept : allReceipts.map((r) => r.receipt);
  const spendLimitSummary =
    spendLimit !== undefined && limitResult ? summarizeSpendLimit(spendLimit, limitResult) : undefined;

  const forwardedCount = receipts.filter((r) => r.source === "Forwarded").length;
  const manualCount = receipts.filter((r) => r.source === "Manual").length;
  console.log(
    `[export] Exporting ${receipts.length} receipt(s) (${forwardedCount} forwarded, ${manualCount} manual), skipped ${skipped.length}`
  );

  const buffer = await buildReceiptWorkbook(receipts, {
    rangeLabel: describeDateRange(query),
    skippedCount: skipped.length,
    spendLimit: spendLimitSummary,
  });
  const labels = [filenameLabel, spendLimit !== undefined ? spendLimitFilenameLabel(spendLimit) : ""].filter(Boolean);
  const filename = `grab_receipts${labels.map((l) => "_" + l).join("")}.xlsx`;

  const meta: ExportMeta = {
    totalFound: found.length,
    exported: receipts.length,
    byService: countByService(receipts),
    skipped,
    spendLimit: spendLimitSummary,
    manual: manualCount,
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
