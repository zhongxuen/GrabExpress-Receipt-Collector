# GrabExpress Receipt Compiler
## Project Plan (Coding AI)

## Objective

Build a **web app**, deployed on **Vercel**, that lets any Gmail user sign in with Google, extracts
all **GrabExpress** receipts from their mailbox, and downloads the results as an Excel spreadsheet.

The tool should support natural date filtering, for example:

- Since June 2026
- June 2026 only
- 2025
- Last 30 days
- Custom date range

The output should contain one row per receipt.

---

# Functional Requirements

## Sign-in

- "Sign in with Google" on the landing page.
- OAuth consent requests the read-only Gmail scope
  (`https://www.googleapis.com/auth/gmail.readonly`) plus basic profile/email.
- Any Google account may sign in (multi-user, not restricted to the developer's own account).
- Session persists via an encrypted cookie so the user doesn't need to grant access again within
  the same session/token lifetime.

## Gmail Search

Search Gmail using the Gmail API (never scrape the Gmail UI), on behalf of the signed-in user's
access token.

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

The Gmail search itself is the date filter (`after:`/`before:` query params) — there is no
separate in-memory date filtering step.

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

Export to Excel (.xlsx), generated **in-memory** on the server and streamed straight to the
browser as a file download (`Content-Disposition: attachment`). Serverless functions on Vercel
have no persistent disk, so the file is never written to a folder on the server — there is no
`outputs/` directory in this version.

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

# Web UI

A single page with:

1. Sign-in state (Google sign-in button, or signed-in user's email + sign-out).
2. A date-range control supporting:
   - All receipts (no filter)
   - Since a given date
   - A specific month
   - A custom from/to range
   - Free-form natural language phrases ("last 90 days", "this month", "2025", "last year")
3. A "Generate spreadsheet" action that calls the export API route and triggers the file download
   client-side once the response arrives.
4. Progress/status feedback while the export runs (searching → found N receipts → processing →
   done), since a large mailbox may take a while inside a single request.
5. Inline reporting of skipped messages (message ID + reason), e.g. "Skipped: Message ID xxx —
   Booking Code not found" — surfaced in the UI response, not just server logs.

---

# Suggested Project Structure

```
grabexpress-receipts/

    app/
        page.tsx                     # main UI: sign-in + date filter + export button
        api/
            auth/[...nextauth]/route.ts   # NextAuth.js Google OAuth config
            export/route.ts               # POST: run search + parse + build xlsx, stream back

    lib/
        gmailClient.ts               # Gmail API search + fetch raw HTML body
        receiptParser.ts             # HTML -> Receipt, base parser + GrabExpress subclass
        exporter.ts                  # Receipt[] -> .xlsx buffer (exceljs)
        dateFilters.ts               # natural-language / structured date input -> Gmail query
        types.ts                     # Receipt type, shared types

    package.json
    next.config.js
    tsconfig.json
    .env.local.example              # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, etc.

    README.md
```

---

# Gmail Client (`lib/gmailClient.ts`)

Responsibilities:

- Given the signed-in user's OAuth access token, search Gmail via the Gmail API.
- Download the HTML body of matching messages.
- Return raw email data (message ID + HTML) to the caller.

Should not contain parsing logic.

---

# Receipt Parser (`lib/receiptParser.ts`)

Responsibilities:

Receive HTML.

Extract:

- Date
- Booking Code
- Amount

Return

```ts
interface Receipt {
  date: string;        // YYYY-MM-DD
  receiptNo: string;    // Booking Code
  amount: number;
  messageId: string;    // internal only, not exported to the spreadsheet
}
```

Parser should tolerate minor HTML layout changes.

Prefer:

- `cheerio` (CSS-selector HTML parsing, the JS equivalent of BeautifulSoup)
- Regex only where necessary

Avoid hardcoding element positions.

Design with a base parser interface/class so future Grab receipt types (GrabFood, GrabCar,
GrabMart) can be added later without changing this module's contract. Only GrabExpress is
implemented now.

---

# Excel Exporter (`lib/exporter.ts`)

Responsibilities:

Receive list of Receipt objects.

Generate an `.xlsx` **buffer in memory** (no disk writes) using `exceljs`.

Formatting:

- Bold header
- Numeric amount
- Date formatting (YYYY-MM-DD)
- Auto column widths

The API route sets the response headers (`Content-Type`,
`Content-Disposition: attachment; filename=...`) and returns the buffer directly.

---

# Error Handling

Gracefully handle:

- Missing/expired OAuth session (redirect back to sign-in)
- Gmail API errors/rate limits
- Empty search results
- HTML parsing failures
- Missing fields

Skip and report per-message failures instead of failing the whole export. Return skipped entries
(message ID + reason) in the API response so the UI can display them, e.g.:

```
Skipped:
Message ID xxx
Reason:
Booking Code not found
```

---

# Suggestions

## 1. Parse Booking Code as Receipt Number

Although the email subject says "Receipt", GrabExpress emails do not appear to expose a dedicated
receipt number consistently.

The Booking Code is the most stable unique identifier and should be used as the Receipt Number
unless a true invoice/receipt ID is found.

---

## 2. Store Gmail Message ID

Internally track:

- Gmail Message ID

Not exported to the spreadsheet.

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

Surface progress in the UI while an export request is in flight, e.g.:

```
Searching Gmail...

Found 428 receipts

Processing...

[152 / 428]

Exporting...

Done.
```

Since everything runs inside a single request/response on serverless, this may require streaming
partial progress (e.g. Server-Sent Events or a polling status endpoint) rather than a single
blocking response, especially for large mailboxes. Keep this in mind if a user's mailbox export
risks running long — Vercel serverless functions have execution time limits.

---

## 6. Logging

Log server-side (Vercel function logs are sufficient) — no local `logs/` folder, since there is no
persistent disk. Include:

- Search query
- Receipts found
- Parsing failures

---

## 7. Natural Date Filters

(Optional but recommended)

Allow user-friendly inputs in the UI:

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

# Authentication

Use OAuth 2.0 via Google, configured as a **web application** OAuth client (not "Desktop app"),
with an authorized redirect URI pointing at the deployed Vercel domain (and `localhost` for local
dev).

Flow:

1. User visits the site and clicks "Sign in with Google".
2. Google consent screen requests read-only Gmail access.
3. On success, the OAuth session (access token + refresh token) is stored in an **encrypted
   session cookie** managed by NextAuth.js — no server-side database or token file.
4. Subsequent requests within the session reuse the stored token automatically; NextAuth refreshes
   the access token using the refresh token when it expires.
5. No `credentials.json` / `token.json` files — OAuth client ID/secret live in environment
   variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) configured in Vercel project settings.

Because this app is open to any Gmail user and requests the sensitive `gmail.readonly` scope, the
Google OAuth consent screen normally needs to go through Google's verification process for
production use with unverified apps' request limited to added test users and shown an "unverified
app" warning in the meantime.

---

# Libraries

Recommended:

```
next
react / react-dom
next-auth
googleapis
cheerio
exceljs
date-fns (or chrono-node for free-form natural language parsing)
```

---

# Out of Scope

Do NOT implement:

- Gmail web scraping
- Browser automation (Playwright/Selenium)
- PDF parsing
- OCR
- Google Sheets export
- Database storage (session state lives in the encrypted auth cookie, not a DB)

This project is a web app that authenticates with Gmail via the official Gmail API, extracts
GrabExpress receipt data from email HTML, and lets the signed-in user download the results as a
formatted Excel file — deployed on Vercel.
