import ExcelJS from "exceljs";
import type { GrabService, Receipt } from "./types";

/** Per-service receipt counts for the export summary shown in the UI. */
export function countByService(receipts: Receipt[]): Record<GrabService, number> {
  const counts: Record<GrabService, number> = { express: 0, food: 0, transport: 0 };
  for (const receipt of receipts) counts[receipt.category] += 1;
  return counts;
}

/** Context written to the Summary sheet so a saved file records what it covers. */
export interface WorkbookOptions {
  /** e.g. "2026-06-01 to 2026-06-30" or "All time" — see describeDateRange. */
  rangeLabel?: string;
  isDemo?: boolean;
  skippedCount?: number;
  generatedAt?: Date;
}

// Style constants — tweak the look of the whole workbook from here.
// Header green is a darker shade of Grab's brand green (#00B14F): white text
// on the brand green itself is too low-contrast to read comfortably.
const HEADER_FILL = "FF00704A";
const HEADER_FONT_COLOR = "FFFFFFFF";
const ROW_DIVIDER = "FFD9D9D9";
const TOTAL_FILL = "FFF2F2F2";
const FORWARDED_FILL = "FFFFF2CC";
const FORWARDED_FONT_COLOR = "FF9C6500";
const DATE_FORMAT = "yyyy-mm-dd";
const AMOUNT_FORMAT = "#,##0.00";

type Align = "left" | "center" | "right";

interface ColumnSpec {
  header: string;
  key: string;
  align: Align;
  /** Widest the column may auto-size to; longer values wrap instead. */
  maxWidth: number;
  /** Size to the 80th-percentile value rather than the longest, so one very
   * long address doesn't make the whole column huge (that row just wraps). */
  percentile?: boolean;
}

const RECEIPT_COLUMNS: ColumnSpec[] = [
  { header: "Date", key: "date", align: "center", maxWidth: 14 },
  { header: "Receipt Number", key: "receiptNo", align: "left", maxWidth: 40 },
  { header: "Service", key: "service", align: "left", maxWidth: 40 },
  { header: "Merchant", key: "merchant", align: "left", maxWidth: 40 },
  { header: "Pickup", key: "pickup", align: "left", maxWidth: 45, percentile: true },
  { header: "Drop-off", key: "dropoff", align: "left", maxWidth: 45, percentile: true },
  { header: "Amount (RM)", key: "amount", align: "right", maxWidth: 18 },
  { header: "Source", key: "source", align: "center", maxWidth: 14 },
];

const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });

/**
 * Builds an .xlsx workbook from receipts and returns it as an in-memory
 * buffer. Never touches disk — Vercel serverless functions have no
 * persistent filesystem.
 */
export async function buildReceiptWorkbook(
  receipts: Receipt[],
  options: WorkbookOptions = {}
): Promise<Buffer> {
  const generatedAt = options.generatedAt ?? new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Grab Receipt Collector";
  workbook.title = "Grab Receipts";
  workbook.created = generatedAt;

  const sorted = [...receipts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.receiptNo.localeCompare(b.receiptNo)
  );

  const sheet = workbook.addWorksheet("Receipts");
  const lastDataRow = buildReceiptsSheet(sheet, sorted);
  buildSummarySheet(workbook.addWorksheet("Summary"), sorted, lastDataRow, options, generatedAt);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Fills the Receipts sheet and returns the last data row number (1 if empty). */
function buildReceiptsSheet(sheet: ExcelJS.Worksheet, receipts: Receipt[]): number {
  sheet.columns = RECEIPT_COLUMNS.map(({ header, key }) => ({ header, key }));
  styleHeaderRow(sheet.getRow(1), RECEIPT_COLUMNS);

  for (const receipt of receipts) {
    const row = sheet.addRow({
      // A real date (not the "YYYY-MM-DD" string) so Excel can sort it and
      // group it by Year → Month in the filter dropdown.
      date: toExcelDate(receipt.date),
      receiptNo: receipt.receiptNo,
      service: receipt.service,
      merchant: receipt.merchant ?? "",
      pickup: receipt.pickup ?? "",
      dropoff: receipt.dropoff ?? "",
      amount: receipt.amount,
      source: receipt.source,
    });
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: thin(ROW_DIVIDER) };
    });

    // Flag forwarded receipts visually — they're still legitimate Grab
    // receipts, just relayed through another mailbox rather than sent
    // directly by no-reply@grab.com, so they're worth a second look.
    if (receipt.source === "Forwarded") {
      row.getCell("source").font = { italic: true, color: { argb: FORWARDED_FONT_COLOR } };
      row.getCell("source").fill = { type: "pattern", pattern: "solid", fgColor: { argb: FORWARDED_FILL } };
    }
  }

  const lastDataRow = receipts.length + 1;
  sheet.getColumn("date").numFmt = DATE_FORMAT;
  sheet.getColumn("amount").numFmt = AMOUNT_FORMAT;
  // Text format so long numeric-looking IDs never turn into 1.23E+11.
  sheet.getColumn("receiptNo").numFmt = "@";

  if (receipts.length === 0) {
    const cell = sheet.getCell(2, 1);
    cell.value = "No receipts found for this date range";
    cell.font = { italic: true, color: { argb: "FF808080" } };
  } else {
    addReceiptsTotalRow(sheet, receipts, lastDataRow);
  }

  // Keep the header visible while scrolling, and make every column
  // filterable straight away (e.g. Service = rides only, for expense claims).
  // The filter range stops at the last data row so sorting never moves the total.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(lastDataRow, 1), column: RECEIPT_COLUMNS.length },
  };

  autoFitColumns(sheet, RECEIPT_COLUMNS, receipts.length > 0 ? lastDataRow + 1 : 1);
  applyPrintSetup(sheet, "landscape");
  return lastDataRow;
}

function addReceiptsTotalRow(sheet: ExcelJS.Worksheet, receipts: Receipt[], lastDataRow: number) {
  const row = sheet.getRow(lastDataRow + 1);
  const countLetter = sheet.getColumn("receiptNo").letter;
  const amountLetter = sheet.getColumn("amount").letter;
  const total = roundCents(receipts.reduce((sum, r) => sum + r.amount, 0));

  row.getCell("date").value = "Total";
  // SUBTOTAL (not SUM) so the totals follow the autofilter: filter to rides
  // only and the total shows rides only. 103/109 = COUNTA/SUM ignoring hidden
  // rows. Cached results let previewers that don't recalculate (Gmail,
  // phones) still show the numbers.
  row.getCell("receiptNo").value = {
    formula: `SUBTOTAL(103,${countLetter}2:${countLetter}${lastDataRow})`,
    result: receipts.length,
  };
  row.getCell("receiptNo").numFmt = '0 "receipts"';
  row.getCell("amount").value = {
    formula: `SUBTOTAL(109,${amountLetter}2:${amountLetter}${lastDataRow})`,
    result: total,
  };
  styleTotalRow(row, RECEIPT_COLUMNS.length);
}

/** Per-service counts and amounts, driven by formulas on the Receipts sheet so
 * they stay correct if the user edits it. */
function buildSummarySheet(
  sheet: ExcelJS.Worksheet,
  receipts: Receipt[],
  lastDataRow: number,
  options: WorkbookOptions,
  generatedAt: Date
) {
  const columns: ColumnSpec[] = [
    { header: "Service", key: "service", align: "left", maxWidth: 40 },
    { header: "Receipts", key: "count", align: "right", maxWidth: 14 },
    { header: "Amount (RM)", key: "amount", align: "right", maxWidth: 18 },
  ];
  sheet.columns = columns.map(({ key }) => ({ key }));

  sheet.getCell("A1").value = "Grab Receipts Summary";
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: HEADER_FILL } };

  // Plain text, not a date cell: a number-formatted cell can't overflow into
  // the empty cell beside it and would show "####" in the narrow column.
  const generated = `${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const info: [string, string][] = [
    ["Generated", generated],
    ["Date range", options.rangeLabel ?? "All time"],
  ];
  if (options.isDemo) info.push(["Mode", "Demo data (synthetic receipts, not from a real inbox)"]);
  info.forEach(([label, value], i) => {
    const row = sheet.getRow(3 + i);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
    row.getCell(2).alignment = { horizontal: "left" };
  });

  const headerRowNumber = 3 + info.length + 1;
  const headerRow = sheet.getRow(headerRowNumber);
  columns.forEach((col, i) => (headerRow.getCell(i + 1).value = col.header));
  styleHeaderRow(headerRow, columns);

  const receiptsRange = (key: string) => {
    const letter = columnLetter(RECEIPT_COLUMNS.findIndex((col) => col.key === key));
    return `Receipts!$${letter}$2:$${letter}$${lastDataRow}`;
  };
  const serviceRange = receiptsRange("service");
  const amountRange = receiptsRange("amount");
  const services = [...new Set(receipts.map((r) => r.service))].sort();
  let rowNumber = headerRowNumber;
  for (const service of services) {
    rowNumber += 1;
    const matching = receipts.filter((r) => r.service === service);
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = service;
    row.getCell(2).value = { formula: `COUNTIFS(${serviceRange},A${rowNumber})`, result: matching.length };
    row.getCell(3).value = {
      formula: `SUMIFS(${amountRange},${serviceRange},A${rowNumber})`,
      result: roundCents(matching.reduce((sum, r) => sum + r.amount, 0)),
    };
    row.getCell(3).numFmt = AMOUNT_FORMAT;
    row.eachCell({ includeEmpty: true }, (cell) => (cell.border = { bottom: thin(ROW_DIVIDER) }));
  }

  const firstServiceRow = headerRowNumber + 1;
  const totalRow = sheet.getRow(rowNumber + 1);
  totalRow.getCell(1).value = "Total";
  totalRow.getCell(2).value = services.length
    ? { formula: `SUM(B${firstServiceRow}:B${rowNumber})`, result: receipts.length }
    : 0;
  totalRow.getCell(3).value = services.length
    ? {
        formula: `SUM(C${firstServiceRow}:C${rowNumber})`,
        result: roundCents(receipts.reduce((sum, r) => sum + r.amount, 0)),
      }
    : 0;
  totalRow.getCell(3).numFmt = AMOUNT_FORMAT;
  styleTotalRow(totalRow, columns.length);

  // Message IDs and reasons stay internal (the app's UI lists them); the file
  // only records that some emails couldn't be read.
  if (options.skippedCount) {
    const row = sheet.getRow(rowNumber + 3);
    row.getCell(1).value = "Skipped emails";
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = options.skippedCount;
    row.getCell(3).value = "Reasons are listed in the app";
    row.getCell(3).font = { italic: true, color: { argb: "FF808080" } };
  }

  // Only size from the table itself — the title and info lines are allowed to
  // overflow into the empty cells beside them.
  autoFitColumns(sheet, columns, rowNumber + 1, headerRowNumber);
  applyPrintSetup(sheet, "portrait");
}

function styleHeaderRow(row: ExcelJS.Row, columns: ColumnSpec[]) {
  row.height = 22;
  columns.forEach((col, i) => {
    const cell = row.getCell(i + 1);
    cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: col.align, vertical: "middle" };
    cell.border = { bottom: thin(HEADER_FILL) };
  });
}

function styleTotalRow(row: ExcelJS.Row, columnCount: number) {
  for (let i = 1; i <= columnCount; i++) {
    const cell = row.getCell(i);
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: thin("FF808080"), bottom: { style: "double", color: { argb: "FF808080" } } };
  }
}

/**
 * ExcelJS has no real autofit, so size each column from the text the user
 * will actually *see* (formatted dates/amounts, not raw values), with extra
 * room on the header for bold text and the autofilter ▼ button. Values
 * longer than the column's cap wrap instead of spilling into the next cell.
 */
function autoFitColumns(
  sheet: ExcelJS.Worksheet,
  columns: ColumnSpec[],
  lastRow: number,
  headerRow = 1
) {
  columns.forEach((spec, i) => {
    const column = sheet.getColumn(i + 1);
    const headerWidth = displayWidth(spec.header) * 1.1 + 3;
    const widths: number[] = [];
    for (let r = headerRow + 1; r <= lastRow; r++) {
      const cell = sheet.getRow(r).getCell(i + 1);
      const text = displayText(cell);
      if (text) widths.push(displayWidth(text) * (cell.font?.bold ? 1.1 : 1));
    }

    widths.sort((a, b) => a - b);
    const longest = widths.length ? widths[widths.length - 1] : 0;
    const content = spec.percentile && widths.length
      ? widths[Math.min(widths.length - 1, Math.floor(widths.length * 0.8))]
      : longest;
    const width = Math.min(Math.max(headerWidth, content + 2, 8), spec.maxWidth);
    column.width = width;

    const needsWrap = longest + 2 > width;
    for (let r = headerRow + 1; r <= lastRow; r++) {
      const cell = sheet.getRow(r).getCell(i + 1);
      cell.alignment = { horizontal: spec.align, vertical: "top", wrapText: needsWrap };
    }
  });
}

function displayText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return DATE_FORMAT; // same length as the rendered date
  if (typeof value === "number") {
    return cell.numFmt === AMOUNT_FORMAT
      ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(value);
  }
  if (typeof value === "object" && "formula" in value) {
    const result = value.result;
    if (typeof result === "number" && cell.numFmt === AMOUNT_FORMAT) {
      return result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (typeof result === "number" && cell.numFmt?.includes("receipts")) return `${result} receipts`;
    return String(result ?? "");
  }
  return String(value);
}

// East-Asian wide characters and emoji take roughly two character widths
// (merchant names can be in Chinese).
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE_CHAR.test(char) ? 2 : 1;
  return width;
}

function applyPrintSetup(sheet: ExcelJS.Worksheet, orientation: "portrait" | "landscape") {
  sheet.pageSetup = {
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  if (sheet.name === "Receipts") sheet.pageSetup.printTitlesRow = "1:1";
  sheet.headerFooter = { oddFooter: "&LGrab Receipts&RPage &P of &N" };
}

/** 0-based column index → letter; the sheets never exceed 26 columns. */
function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function toExcelDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  // UTC midnight: ExcelJS converts Dates to serials in UTC, so this lands on
  // exactly the right calendar day regardless of the server's timezone.
  return new Date(Date.UTC(year, month - 1, day));
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
