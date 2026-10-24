// "Original" = sent directly by no-reply@grab.com with no forwarding markers
// in the body. "Forwarded" = relayed through another mailbox (e.g. by
// whoever booked the delivery) — see CLAUDE.md's Gmail search query notes on
// why forwarded receipts are still searched for and included, just flagged.
export type ReceiptSource = "Original" | "Forwarded";

// Coarse receipt family, matching the UI's service filter. `service` below
// carries the finer label shown in the spreadsheet.
export type GrabService = "express" | "food" | "transport";

export interface Receipt {
  date: string; // YYYY-MM-DD
  receiptNo: string; // Booking Code / Booking ID, or Order ID for GrabFood dine-in
  amount: number;
  /** e.g. "GrabExpress", "GrabFood", "GrabFood (Dine-in)", "GrabCar – Standard (JustGrab)" */
  service: string;
  category: GrabService;
  /** Restaurant for GrabFood; absent for rides and GrabExpress. */
  merchant?: string;
  /** Ride pickup / drop-off location from the "Your Trip" section; rides only. */
  pickup?: string;
  dropoff?: string;
  source: ReceiptSource;
  messageId: string; // internal only, not exported to the spreadsheet
}

export interface SkippedMessage {
  messageId: string;
  reason: string;
}

/** Summary sent back to the UI in the X-Export-Meta header. */
export interface ExportMeta {
  totalFound: number;
  exported: number;
  byService: Record<GrabService, number>;
  skipped: SkippedMessage[];
}

export interface ExportResult {
  receipts: Receipt[];
  skipped: SkippedMessage[];
  filename: string;
}
