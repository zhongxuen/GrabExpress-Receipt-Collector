import ExcelJS from "exceljs";
import type { Receipt } from "./types";

/**
 * Builds an .xlsx workbook from receipts and returns it as an in-memory
 * buffer. Never touches disk — Vercel serverless functions have no
 * persistent filesystem.
 */
export async function buildReceiptWorkbook(receipts: Receipt[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Receipts");

  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Receipt Number", key: "receiptNo", width: 22 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Source", key: "source", width: 12 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const receipt of receipts) {
    const row = sheet.addRow({
      date: receipt.date,
      receiptNo: receipt.receiptNo,
      amount: receipt.amount,
      source: receipt.source,
    });

    // Flag forwarded receipts visually — they're still legitimate GrabExpress
    // receipts, just relayed through another mailbox rather than sent
    // directly by no-reply@grab.com, so they're worth a second look.
    if (receipt.source === "Forwarded") {
      row.getCell("source").font = { italic: true, color: { argb: "FF9C6500" } };
      row.getCell("source").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
    }
  }

  const dateColumn = sheet.getColumn("date");
  dateColumn.numFmt = "yyyy-mm-dd";

  const amountColumn = sheet.getColumn("amount");
  amountColumn.numFmt = "0.00";

  // Auto column width: widen to fit the longest value in each column,
  // bounded so a single outlier doesn't blow out the sheet.
  for (const column of sheet.columns) {
    let maxLength = String(column.header ?? "").length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? "").length;
      if (length > maxLength) maxLength = length;
    });
    column.width = Math.min(Math.max(maxLength + 2, 10), 40);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
