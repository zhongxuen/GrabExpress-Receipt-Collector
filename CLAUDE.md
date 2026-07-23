# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains only `instructions.md`, the project spec. No code has been
written yet. `instructions.md` is the authoritative design doc — read it in full before
implementing anything, since this file only summarizes the parts needed to get oriented quickly.

## What this project is

A local Python CLI tool that authenticates with Gmail via the official Gmail API, finds
GrabExpress receipt emails, parses receipt data out of the email HTML, and exports the results to
a formatted `.xlsx` file. No web scraping, no browser automation, no PDF/OCR, no Sheets export,
no database, no cloud deployment — this stays a local utility.

## Intended architecture

The spec calls for a strict separation of concerns across three modules, each with a single
responsibility:

- **`gmail_client.py`** — OAuth2 authentication, Gmail API search, downloading the raw HTML body
  of matching messages. Contains no parsing logic.
- **`receipt_parser.py`** — Takes raw HTML, returns a `Receipt(date, receipt_no, amount)` object.
  Uses BeautifulSoup + CSS selectors, falling back to regex only where necessary. Must not
  hardcode element positions, since it needs to tolerate minor HTML layout drift. Designed to be
  extended with a base parser class so future Grab receipt types (GrabFood, GrabCar, GrabMart)
  can be added without changing this module's contract — only GrabExpress is implemented now.
- **`exporter.py`** — Takes a list of `Receipt` objects, writes an `.xlsx` via openpyxl (bold
  header row, numeric amount column, `YYYY-MM-DD` date formatting, auto column widths).

`main.py` wires these together and owns the CLI. `config.py` holds shared configuration.

Key design points from the spec that aren't obvious from module names alone:
- The Gmail search itself is the date filter (`after:`/`before:` query params) — there's no
  separate in-memory date filtering step.
- The Booking Code is the Receipt Number. GrabExpress emails don't expose a separate invoice ID.
- Gmail Message ID should be tracked internally (not exported to the spreadsheet) — it's the
  preferred key for deduplication and is useful for reprocessing/debugging.
- Deduplicate by Gmail Message ID (preferred) or Booking Code before writing the spreadsheet.
- Parsing/search failures should be logged and skipped per-message, not fatal to the whole run
  (e.g. "Skipped: Message ID xxx / Reason: Booking Code not found").

## Gmail search query

```
from:no-reply@grab.com
subject:"Your GrabExpress Receipt"
after:YYYY/MM/DD
before:YYYY/MM/DD
```

The CLI should accept natural-language-ish date args (`--since`, `--month`, `--from`/`--to`, and
ideally free-form phrases like "last 90 days") and translate them into this query syntax.

## CLI shape

```
python receipts.py                              # all receipts
python receipts.py --since 2026-06-01
python receipts.py --month 2026-06
python receipts.py --from 2026-06-01 --to 2026-06-30
```

Output filenames follow `grabexpress_receipts[_<range>].xlsx`, written to `outputs/`.

## Auth

OAuth2 via `credentials.json`; token persisted to `token.json` after first browser login so
subsequent runs don't require re-authentication.

## Libraries

`google-api-python-client`, `google-auth`, `google-auth-oauthlib`, `beautifulsoup4`, `lxml`,
`openpyxl`, `python-dateutil`.
