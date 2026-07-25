import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildGmailQuery, DateRangeInput } from "@/lib/dateFilters";
import { searchMessages, fetchMessageContent, getAuthenticatedEmail } from "@/lib/gmailClient";
import { parseGrabExpressReceipt, ReceiptParseError } from "@/lib/receiptParser";
import { buildReceiptWorkbook } from "@/lib/exporter";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { Receipt, SkippedMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Gmail messages are fetched in parallel batches of this size rather than
// one at a time — sequential fetches don't scale to large mailboxes and
// risk exceeding maxDuration above.
const FETCH_CONCURRENCY = 8;

type MessageOutcome =
  | { kind: "receipt"; receipt: Receipt }
  | { kind: "skipped"; skipped: SkippedMessage };

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

  let dateRangeInput: DateRangeInput;
  try {
    dateRangeInput = (await req.json()) as DateRangeInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let query: string;
  let filenameLabel: string;
  try {
    ({ query, filenameLabel } = buildGmailQuery(dateRangeInput));
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
  const outcomes = await mapWithConcurrency(
    found,
    FETCH_CONCURRENCY,
    async ({ messageId }): Promise<MessageOutcome> => {
      try {
        const { html, fromHeader } = await fetchMessageContent(accessToken, messageId);
        if (!html) {
          return { kind: "skipped", skipped: { messageId, reason: "No HTML body found in message" } };
        }
        return { kind: "receipt", receipt: parseGrabExpressReceipt(html, messageId, fromHeader) };
      } catch (err) {
        const reason =
          err instanceof ReceiptParseError
            ? err.message
            : err instanceof Error
              ? `Gmail API error: ${err.message}`
              : "Unexpected error while processing message";
        console.error(`[export] Skipped message ${messageId}: ${reason}`);
        return { kind: "skipped", skipped: { messageId, reason } };
      }
    }
  );

  const receipts: Receipt[] = [];
  const skipped: SkippedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenBookingCodes = new Set<string>();

  for (const outcome of outcomes) {
    if (outcome.kind === "skipped") {
      skipped.push(outcome.skipped);
      continue;
    }
    const { receipt } = outcome;
    if (seenMessageIds.has(receipt.messageId) || seenBookingCodes.has(receipt.receiptNo)) {
      continue; // duplicate, not a failure — silently deduped per spec
    }
    seenMessageIds.add(receipt.messageId);
    seenBookingCodes.add(receipt.receiptNo);
    receipts.push(receipt);
  }

  const forwardedCount = receipts.filter((r) => r.source === "Forwarded").length;
  console.log(
    `[export] Parsed ${receipts.length} receipt(s) (${forwardedCount} forwarded), skipped ${skipped.length}`
  );

  const buffer = await buildReceiptWorkbook(receipts);
  const filename = `grabexpress_receipts${filenameLabel ? "_" + filenameLabel : ""}.xlsx`;

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
