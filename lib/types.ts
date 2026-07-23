export interface Receipt {
  date: string; // YYYY-MM-DD
  receiptNo: string; // Booking Code
  amount: number;
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
