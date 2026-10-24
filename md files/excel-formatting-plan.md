# Excel Formatting Plan

Goal: the downloaded `.xlsx` should be ready to use the moment it opens — readable, correctly
typed (sortable dates, summable amounts), printable, and with columns already sized to their
content — so customers never have to reformat it before filing an expense claim.

Scope: `lib/exporter.ts` only (plus a small signature change at the two call sites in
`app/api/export/route.ts` and `app/api/demo-export/route.ts`). No new dependencies — everything
below is supported by `exceljs@4.4`.

## Problems with the current output

| # | Problem | Impact |
|---|---|---|
| 1 | `date` is written as the string `"2026-06-14"`, so `numFmt = "yyyy-mm-dd"` does nothing | Excel treats dates as text: date sort/filter grouping (Year → Month) doesn't work, date maths fails |
| 2 | Amount format is `0.00` with no currency or thousands separator | `1250.5` reads worse than `1,250.50`; currency is unstated |
| 3 | No total | The first thing anyone does with a receipt list is total it |
| 4 | Header is only bold — no fill, border, alignment | Header doesn't stand out from data; looks unfinished |
| 5 | Rows are in Gmail order (newest-first, roughly), not sorted | Users must sort before reading/claiming |
| 6 | Auto-width measures raw values and ignores the filter dropdown arrow and bold header | Headers like "Receipt Number" get clipped by the ▼ button; dates sized from raw string |
| 7 | No print setup | Printing spills columns onto a second page, header doesn't repeat |
| 8 | No context in the file (date range, generated-at, count, demo vs real) | A file saved weeks later has no record of what it covers |

## Research summary (professional expense/receipt sheet conventions)

- One header row with clear names; bold, light fill, bottom border; freeze it.
- Text left-aligned, numbers right-aligned; header alignment matches its column.
- Amounts stored as true numbers with an accounting/currency format and thousands separator.
- One consistent, unambiguous date format so sort works — ISO `yyyy-mm-dd` is the safest across
  regions (avoids the DD/MM vs MM/DD confusion between MY/SG and US users).
- A total row at the bottom, visually separated (top border, bold, light grey fill).
- A small summary block (by category) is standard on expense reports.
- Fit-to-page-width printing with repeated header rows.

Sources: [thebricks.com – cell styles](https://www.thebricks.com/resources/guide-how-to-apply-good-cell-style-in-excel),
[thebricks.com – total cell style](https://www.thebricks.com/resources/how-to-apply-total-cell-style-in-excel),
[thebricks.com – business expense sheets](https://thebricks.com/resources/guide-how-to-make-an-excel-spreadsheet-for-business-expenses),
[exceldemy – expense report](https://www.exceldemy.com/create-an-expense-report-in-excel/),
[Vena – 10 formatting tips](https://www.venasolutions.com/blog/how-to-format-your-excel-spreadsheet-10-tips),
[Aspose forum – autofit vs date format](https://forum.aspose.com/t/autofit-is-calculated-wrongly-after-setting-the-date-format/194903)
(width must be computed from the *displayed* text, not the raw value).

## Design

### Sheet 1 — "Receipts"

Columns (unchanged order, per CLAUDE.md): **Date | Receipt Number | Service | Merchant | Pickup | Drop-off | Amount (RM) | Source**

Pickup/Drop-off are full street addresses (rides only) and are by far the longest values in the
sheet — they're the main reason wrap-at-cap (see auto-width) and landscape printing are needed.

| Column | Cell value | Format | Align |
|---|---|---|---|
| Date | real `Date` built with `Date.UTC(y, m-1, d)` | `yyyy-mm-dd` | center |
| Receipt Number | string (forced text so long IDs never become `1.23E+11`) | `@` | left |
| Service | string | General | left |
| Merchant | string, blank when absent | General, wrap if over max width | left, top |
| Pickup / Drop-off | string, blank for non-rides | General, wrap if over max width | left, top |
| Amount (RM) | number | `#,##0.00` | right |
| Source | "Original" / "Forwarded" | General (Forwarded keeps existing amber highlight) | center |

Currency: all parsed receipts are RM (the parser only accepts `RM`/`MYR`), so the currency goes in
the header `Amount (RM)` and the cells stay plain numbers — keeps `SUM`/pivot tables clean. If
other currencies are ever supported, add a `currency` field to `Receipt` and a Currency column then.

Styling:
- Font: Calibri 11 throughout (Excel default — looks native, renders everywhere incl. Google Sheets/Numbers).
- Header row: bold white text on dark teal/Grab-green fill (`FF00704A`-ish, tested for contrast),
  thin bottom border, row height ~22, vertically centred, frozen, autofilter on.
- Data rows: thin light-grey (`FFD9D9D9`) bottom border between rows for scanability. No static
  zebra banding — it breaks visually as soon as the user filters/sorts.
- Rows sorted by date ascending, then receipt number (sort done in the exporter, not the routes).
- **Total row** one row below the data: "Total" label in Service column, bold, light grey fill,
  thin top + double bottom border; amount cell = `SUBTOTAL(109, G2:G{n})` (column letter derived
  from the column key, not hardcoded), so the total
  automatically reflects only visible rows when the user filters (e.g. Service = rides only for a
  claim). Count in Receipt Number column = `SUBTOTAL(103, B2:B{n}) & " receipts"`-style or a
  plain `SUBTOTAL(103, …)` with format `0 "receipts"`. Write a cached `result` alongside each
  formula so previewers that don't recalculate (Gmail/Outlook preview, mobile viewers) still show
  the number.
- Autofilter range covers header + data rows only (not the total row), so sorting never moves
  the total.

### Sheet 2 — "Summary"

Small, formula-driven block so it stays correct if the user edits Sheet 1:

```
Grab Receipts Summary
Generated        2026-10-23 14:05
Date range       1 Jun 2026 – 30 Jun 2026      (or "All time")
Mode             Demo data   (only in demo exports)

Service          Receipts    Amount (RM)
GrabFood         =COUNTIFS   =SUMIFS
GrabFood (Dine-in) …
GrabCar – …      …
GrabExpress      …
Total            =SUM        =SUM
Skipped emails   3   (see the app for reasons)
```

- Service rows are the distinct `service` values actually present (sorted), formulas reference
  the Service and Amount columns on Receipts (letters derived from keys), with cached results.
- Same header/total styling as Sheet 1 so the workbook looks like one system.
- "Receipts" stays the first/active sheet — that's what users open the file for.
- Skipped message IDs/reasons are **not** written (Message IDs stay internal per CLAUDE.md); just
  the count, since the UI already lists the reasons.

To support the context lines, change the signature to
`buildReceiptWorkbook(receipts, { rangeLabel?, isDemo?, skippedCount?, generatedAt? })` — both
routes already have this information (`filenameLabel`, `skipped`).

### Auto column width (the "adjust to cell length" requirement)

ExcelJS has no real autofit, so compute it ourselves, but measure what the user will **see**:

1. For each cell, build the displayed string: dates → `yyyy-mm-dd` (10 chars), amounts →
   `toLocaleString("en-US", { minimumFractionDigits: 2 })` (adds commas), text → as-is.
2. Character weighting: count East-Asian wide / emoji characters as 2 (merchant names can be
   Chinese), uppercase/bold ≈ 1.1×.
3. Header width = text length × 1.1 (bold) **+ 3** for the autofilter ▼ button — this is what
   currently clips "Receipt Number".
4. Column width = max(header, longest cell) + 2 padding, clamped to [8, max] where max is 40 for
   Merchant and 45 for Pickup/Drop-off, 50 elsewhere.
5. If a value exceeds its cap (long addresses/merchant names), set `wrapText: true` on that
   column instead of letting it overflow into the next cell, top-align the row, and let it grow.
   Prefer the 80th-percentile length over the max for address columns so one very long address
   doesn't make the whole column huge — that row just wraps.
6. Include the total row and the Summary sheet's columns in the same routine (shared helper
   `autoFitColumns(sheet)`).

### Print & document setup

- `pageSetup`: A4, **landscape** (8 columns incl. two address columns), `fitToPage: true, fitToWidth: 1, fitToHeight: 0`, narrow margins,
  `printTitlesRow: "1:1"` (header repeats on every page), horizontally centred.
- Header/footer: `&L Grab Receipts &R Page &P of &N`.
- Workbook properties: `creator = "Grab Receipt Collector"`, `title`, `created = generatedAt`.

### Empty export

If there are zero receipts, still output the header row plus an italic grey "No receipts found
for this date range" line, so the file isn't confusingly blank.

## Implementation steps

1. `lib/exporter.ts`
   - Add style constants at the top (colours, borders, number formats) so they're tweakable in one place.
   - Sort receipts; convert `date` strings to UTC `Date`s.
   - Rewrite `buildReceiptWorkbook` per the Receipts design above; add total row.
   - Add `buildSummarySheet(workbook, receipts, options)`.
   - Replace the inline width loop with `autoFitColumns(sheet)` measuring displayed text.
   - Add page setup + workbook properties.
2. `app/api/export/route.ts` / `app/api/demo-export/route.ts` — pass `{ rangeLabel, isDemo, skippedCount }`.
3. Update CLAUDE.md "Spreadsheet columns" line (`Amount` → `Amount (RM)`, mention Summary sheet
   and Total row).

## Verification

1. `npm run typecheck && npm run lint && npm run build`.
2. Scratch script (run with `npx tsx`) that calls `buildReceiptWorkbook` on `lib/demoFixtures.ts`
   data (after parsing) and on an empty list, writes both to the scratchpad, then re-reads them
   with ExcelJS and asserts: date cells are `Date` instances, amount cells are numbers, total
   formula + cached result equal the sum, autofilter excludes the total row, Summary totals match.
3. Open the demo file in Excel (and Google Sheets/LibreOffice if available): no `####` cells, no
   clipped headers, filter on Service → total updates, date filter shows Year/Month grouping,
   Print Preview fits one page wide with repeating header.
4. Download via the running app's "Try the demo" flow to confirm the route wiring.

## Open questions

- Header colour: Grab green vs neutral dark slate? (Default: Grab-ish green `FF00704A`.)
- Date display: keep ISO `yyyy-mm-dd` (current spec) or regional `dd/mm/yyyy` / `dd mmm yyyy`?
  (Default: ISO — unambiguous, and the underlying value is a real date either way, so users can
  restyle in one click.)
