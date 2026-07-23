# GrabExpress Receipt Compiler
## Project Plan (Coding AI)

## Objective

Build a tool that extracts all **GrabExpress** receipts from a Gmail account and exports them into an Excel spreadsheet.

The tool should support natural date filtering, for example:

- Since June 2026
- June 2026 only
- 2025
- Last 30 days
- Custom date range

The output should contain one row per receipt.

---

# Functional Requirements

## Gmail Search

Search Gmail using the Gmail API instead of scraping Gmail UI.

Search filters:

```
from:no-reply@grab.com
subject:"Your GrabExpress Receipt"
```

Support additional date filters:

```
after:2026/06/01
before:2026/07/01
```

Examples:

```
Since June 2026

from:no-reply@grab.com
subject:"Your GrabExpress Receipt"
after:2026/06/01
```

```
June 2026 only

from:no-reply@grab.com
subject:"Your GrabExpress Receipt"
after:2026/06/01
before:2026/07/01
```

---

# Receipt Parsing

For every matching email:

Download the HTML body.

Extract:

- Receipt Date
- Receipt Number / Booking Code
- Total Amount

Example output:

| Date | Receipt No | Amount |
|------|------------|---------|
|2026-06-25|A-9GOVVE8GX938AV|22.00|

The provided sample receipt contains:

- Date
- Booking code
- Total amount

These fields should be parsed from the email HTML rather than relying on Gmail metadata.

---

# Export

Export to Excel (.xlsx)

Columns:

| Column |
|---------|
| Date |
| Receipt Number |
| Amount |

Formatting:

- Date formatted as YYYY-MM-DD
- Amount stored as numeric
- Auto width columns
- Header row bold

Filename examples:

```
grabexpress_receipts.xlsx

grabexpress_receipts_2026.xlsx

grabexpress_receipts_June2026.xlsx
```

---

# CLI Interface

Support commands such as:

```
python receipts.py
```

Exports all receipts.

```
python receipts.py --since 2026-06-01
```

```
python receipts.py --month 2026-06
```

```
python receipts.py --from 2026-06-01 --to 2026-06-30
```

---

# Gmail Authentication

Use OAuth 2.0.

Flow:

1. First run opens browser.
2. User logs into Gmail.
3. OAuth token stored locally.
4. Future runs reuse token automatically.

Do NOT ask user to log in every run.

---

# Suggested Project Structure

```
grabexpress-receipts/

    main.py

    gmail_client.py
    receipt_parser.py
    exporter.py

    config.py

    credentials.json
    token.json

    outputs/

    requirements.txt

    README.md
```

---

# Gmail Client

Responsibilities:

- Authenticate Gmail
- Search emails
- Download HTML body
- Return raw email data

Should not contain parsing logic.

---

# Receipt Parser

Responsibilities:

Receive HTML.

Extract:

- Date
- Booking Code
- Amount

Return

```python
Receipt(
    date,
    receipt_no,
    amount
)
```

Parser should tolerate minor HTML layout changes.

Prefer:

- BeautifulSoup
- CSS selectors
- Regex only where necessary

Avoid hardcoding element positions.

---

# Excel Exporter

Responsibilities:

Receive list of Receipt objects.

Generate:

```
.xlsx
```

Use openpyxl.

Formatting:

- Bold header
- Numeric amount
- Date formatting
- Auto column widths

---

# Error Handling

Gracefully handle:

- Invalid Gmail credentials
- Expired OAuth token
- Empty search results
- HTML parsing failures
- Missing fields

Log skipped receipts instead of stopping the whole export.

Example:

```
Skipped:
Message ID xxx
Reason:
Booking Code not found
```

---

# Suggestions

## 1. Parse Booking Code as Receipt Number

Although the email subject says "Receipt", GrabExpress emails do not appear to expose a dedicated receipt number consistently.

The Booking Code is the most stable unique identifier and should be used as the Receipt Number unless a true invoice/receipt ID is found.

---

## 2. Store Gmail Message ID

Internally store:

- Gmail Message ID

Not exported by default.

Useful for:

- Debugging
- Deduplication
- Reprocessing

---

## 3. Deduplicate Results

Before exporting:

Deduplicate using either:

- Gmail Message ID (preferred)
- Booking Code

Prevents duplicate rows.

---

## 4. Support Future Grab Receipt Types

Design the parser so new receipt types can be added later.

Example:

```
Base Parser

├── GrabExpress
├── GrabFood
├── GrabCar
├── GrabMart
```

Current project only implements GrabExpress.

---

## 5. Progress Display

Display progress:

```
Searching Gmail...

Found 428 receipts

Processing...

[152 / 428]

Exporting...

Done.
```

Useful for large mailboxes.

---

## 6. Logging

Generate a log file:

```
logs/

2026-07-23.log
```

Include:

- Search query
- Receipts found
- Export filename
- Parsing failures

---

## 7. Natural Date Filters

(Optional but recommended)

Allow user-friendly inputs:

```
since June 2026

June 2026

2025

last year

last 90 days

this month
```

Convert internally into Gmail search syntax.

Example:

```
June 2026

↓

after:2026/06/01
before:2026/07/01
```

---

# Libraries

Recommended:

```
google-api-python-client

google-auth

google-auth-oauthlib

beautifulsoup4

lxml

openpyxl

python-dateutil
```

---

# Out of Scope

Do NOT implement:

- Gmail web scraping
- Browser automation (Playwright/Selenium)
- PDF parsing
- OCR
- Google Sheets export
- Cloud deployment
- Database storage

The project should be a local utility that authenticates with Gmail via the official Gmail API, extracts GrabExpress receipt data from email HTML, and exports the results to a formatted Excel file.