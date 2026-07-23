import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildGmailQuery, DateRangeInput } from "@/lib/dateFilters";
import { searchMessages, fetchMessageHtml } from "@/lib/gmailClient";
import { parseGrabExpressReceipt, ReceiptParseError } from "@/lib/receiptParser";
import { buildReceiptWorkbook } from "@/lib/exporter";
import type { Receipt, SkippedMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  console.log(`[export] Gmail search query: ${query}`);

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

  const receipts: Receipt[] = [];
  const skipped: SkippedMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenBookingCodes = new Set<string>();

  for (const { messageId } of found) {
    try {
      const html = await fetchMessageHtml(session.accessToken, messageId);
      if (!html) {
        skipped.push({ messageId, reason: "No HTML body found in message" });
        continue;
      }

      const receipt = parseGrabExpressReceipt(html, messageId);

      if (seenMessageIds.has(receipt.messageId) || seenBookingCodes.has(receipt.receiptNo)) {
        continue; // duplicate, not a failure — silently deduped per spec
      }
      seenMessageIds.add(receipt.messageId);
      seenBookingCodes.add(receipt.receiptNo);
      receipts.push(receipt);
    } catch (err) {
      const reason =
        err instanceof ReceiptParseError
          ? err.message
          : err instanceof Error
            ? `Gmail API error: ${err.message}`
            : "Unexpected error while processing message";
      console.error(`[export] Skipped message ${messageId}: ${reason}`);
      skipped.push({ messageId, reason });
    }
  }

  console.log(`[export] Parsed ${receipts.length} receipt(s), skipped ${skipped.length}`);

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
