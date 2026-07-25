// "Original" = sent directly by no-reply@grab.com with no forwarding markers
// in the body. "Forwarded" = relayed through another mailbox (e.g. by
// whoever booked the delivery) — see CLAUDE.md's Gmail search query notes on
// why forwarded receipts are still searched for and included, just flagged.
export type ReceiptSource = "Original" | "Forwarded";

export interface Receipt {
  date: string; // YYYY-MM-DD
  receiptNo: string; // Booking Code
  amount: number;
  source: ReceiptSource;
  messageId: string; // internal only, not exported to the spreadsheet
}

export interface SkippedMessage {
  messageId: string;
  reason: string;
}

export interface ExportResult {
  receipts: Receipt[];
  skipped: SkippedMessage[];
  filename: string;
}
