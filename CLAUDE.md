# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The Next.js app described below has been scaffolded and implemented per `instructions.md` (the
authoritative design doc — consult it in full for anything not covered by this summary): Google
sign-in via NextAuth, Gmail search/fetch, GrabExpress HTML parsing, in-memory `.xlsx` export, and
the single-page UI all exist under `app/` and `lib/`. Typecheck, lint, and `next build` all pass.
Remaining before production use: real Google OAuth credentials (`GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET`/`NEXTAUTH_SECRET` in `.env.local` and Vercel), a Vercel deployment, and
manual testing against a real Gmail inbox. Parsing has been verified against real raw (Gmail
"Show original") receipt HTML for GrabExpress, GrabFood delivery/dine-in, and GrabCar rides.

An earlier version of this project was a local Python CLI tool; it has been superseded by the web
app design below and the Python implementation was removed from the repo (still recoverable via
git history if ever needed).

## What this project is

A **Next.js web app, deployed on Vercel**, that lets any Gmail user sign in with Google,
authenticates with Gmail via the official Gmail API, finds Grab receipt emails (GrabFood delivery
and dine-in, GrabCar rides, and GrabExpress — see `md files/general-grab-receipts-plan.md`), parses
receipt data out of the email HTML, and lets the user download the results as a formatted `.xlsx`
file. No web scraping, no browser automation, no PDF/OCR, no Sheets export, no database — session
state lives in an encrypted auth cookie, not a persisted store.

## Intended architecture

Next.js (App Router) with a strict separation of concerns across `lib/` modules, each with a
single responsibility:

- **`lib/gmailClient.ts`** — Given the signed-in user's OAuth access token (from the NextAuth
  session), search the Gmail API and download the raw HTML body of matching messages. Contains no
  parsing logic.
- **`lib/receiptParser.ts`** — Takes raw HTML, returns a `Receipt { date, receiptNo, amount,
  service, category, merchant?, source, messageId }` object. Uses `cheerio` + label proximity,
  falling back to regex only where necessary. Must not hardcode element positions, since it needs
  to tolerate minor HTML layout drift. `BaseGrabReceiptParser` holds the shared plumbing (label
  lookup, forward-header stripping, space-joined text flattening); `GrabExpressReceiptParser`,
  `GrabFoodReceiptParser` (delivery + dine-in), and `GrabTransportReceiptParser` (rides) each
  supply their own label regexes. `parseGrabReceipt(html, messageId, from, subject)` picks the
  parser (see "Gmail search query" below for why the body, not just the subject, decides).
  GrabMart/GrabBike/GrabPay payment receipts aren't supported; unrecognised layouts are skipped
  with a reason rather than misparsed.
- **`lib/exporter.ts`** — Takes a list of `Receipt` objects, builds an `.xlsx` **in-memory buffer**
  via `exceljs` (bold header row, numeric amount column, `YYYY-MM-DD` date formatting, auto column
  widths). No disk writes — Vercel serverless functions have no persistent filesystem.

`app/api/export/route.ts` wires these together, runs the search → parse → export pipeline, and
streams the `.xlsx` buffer back as a file download (`Content-Disposition: attachment`).
`app/api/auth/[...nextauth]/route.ts` owns Google OAuth via NextAuth.js. `app/page.tsx` is the UI:
sign-in state, date-range controls, and the export/download action.

Key design points from the spec that aren't obvious from module names alone:

- The Gmail search itself is the date filter (`after:`/`before:` query params) — there's no
  separate in-memory date filtering step.
- The optional **spend limit** ("last RM500 spent", `lib/spendLimit.ts`) is the one filter Gmail
  can't do, so it's applied after parsing: receipts are walked newest-first by their printed date
  and kept until the next one would push the total over the limit (never over; contiguous — a
  receipt that doesn't fit ends the window rather than being skipped). The excluded "next receipt"
  is noted on the Summary sheet and in the UI. `/api/export` fetches newest-first in batches and
  stops early once the oldest fetched email's arrival (`internalDate`) predates the excluded
  receipt's date — safe because a receipt's date is never after its email's arrival.
- The Booking Code (GrabExpress, GrabFood delivery) / Booking ID (rides) is the Receipt Number —
  Grab doesn't expose a separate invoice ID. GrabFood dine-in has no booking code, so its Order ID
  (`0014…-C8…`) is used instead.
- Spreadsheet columns: Date | Receipt Number | Service | Merchant | Pickup | Drop-off | Amount (RM) |
  Source, sorted by date, with a `SUBTOTAL` total row (follows the autofilter) and a formula-driven
  "Summary" sheet (per-service count/amount, date range, generated-at, demo flag, skipped count).
  Formatting/auto-width rationale lives in `md files/excel-formatting-plan.md`. Merchant is the restaurant for GrabFood; Pickup/Drop-off are filled for rides only (from
  the "Your Trip" section, anchored on the `alt="pick-up"`/`alt="drop-off"` icons). GrabExpress
  addresses are not exported.
- Gmail Message ID should be tracked internally (not exported to the spreadsheet) — it's the
  preferred key for deduplication and is useful for reprocessing/debugging.
- Deduplicate by Gmail Message ID (preferred) or Booking Code before building the spreadsheet.
- Parsing/search failures should be logged and skipped per-message, not fatal to the whole export
  (e.g. "Skipped: Message ID xxx / Reason: Booking Code not found"), and surfaced back to the UI in
  the API response — not just server-side logs.
- Any Gmail user can sign in (multi-user). This is a sensitive-scope (`gmail.readonly`) OAuth app,
  so the Google consent screen will show an "unverified app" warning / be limited to test users
  until it passes Google's verification review.
- There is no `outputs/` folder and no `token.json`/`credentials.json` — those belonged to the old
  local CLI design. OAuth client ID/secret and the NextAuth secret are environment variables
  (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`), configured in Vercel project
  settings (and `.env.local` for local dev).
- Vercel serverless functions have execution time limits — a very large mailbox export running
  synchronously in one request is a real constraint to keep in mind (see the "Progress Display"
  suggestion in `instructions.md`).

## Gmail search query

```
(subject:"Your GrabExpress Receipt" OR subject:"Your Grab E-Receipt")
after:YYYY/MM/DD
before:YYYY/MM/DD
```

No `from:` filter: confirmed against a real inbox that GrabExpress receipts often arrive forwarded
by whoever booked the delivery rather than sent directly by `no-reply@grab.com`, so filtering on
sender silently excluded them (this was the root cause of a "0 receipts found" bug — see git log
for the fix). The subject phrases survive forwarding since Gmail just prepends "Fwd:", so they stay
a reliable, low-false-positive filter on their own; the parser's field extraction is the backstop
against any non-receipt email that happens to match.

GrabFood and GrabCar rides share the **same** subject, `Your Grab E-Receipt`, with completely
different HTML (food uses GrabExpress-style label/value tables; rides use a newer div layout). So
`parseGrabReceipt` dispatches on the body: "enjoyed your ride" → rides, "enjoyed your food" (or
`Vehicle type:`/`Type of order:` labels) → GrabFood, a GrabExpress subject → GrabExpress, anything
else → skipped as "Unrecognised Grab E-Receipt layout". The UI's optional service filter narrows
the Gmail query the same way (`subject:"Your Grab E-Receipt" "enjoyed your food"` etc.) instead of
filtering after the fetch; with all services selected it uses the plain subject union above.

The UI should accept natural-language-ish date inputs (since/month/from-to, and ideally free-form
phrases like "last 90 days") and translate them into this query syntax.

## Web UI shape

- Sign in with Google → grants read-only Gmail access.
- Choose a date range: all time / since a date / a specific month / custom from–to / free-form
  phrase.
- Choose services (GrabFood / Rides / GrabExpress, all on by default).
- Click "Generate spreadsheet" → server runs the pipeline → browser downloads
  `grab_receipts[_<range>].xlsx` (demo: `grab_receipts_demo.xlsx`).
- The result shows a per-service breakdown; skipped/failed messages are shown inline.

## Demo Mode

Since `gmail.readonly` is a sensitive OAuth scope, real sign-in only works for accounts added as
Google test users (see `md files/adding-test-users.md`) until the app passes verification — that
doesn't scale to anonymous portfolio traffic. Demo Mode (see `md files/demo-mode-plan.md`) sidesteps
this: `app/api/demo-export/route.ts` mirrors `app/api/export/route.ts` but sources input from
`lib/demoFixtures.ts` (bundled synthetic GrabExpress messages) instead of the Gmail API, requires no
auth, and runs through the exact same `parseGrabExpressReceipt` → dedupe → `buildReceiptWorkbook`
pipeline as the real export — it's exercising the real parser/exporter, not a mock. It's rate-limited
per-IP via `lib/rateLimit.ts` (best-effort in-memory, since it has no auth gate). In `app/page.tsx`,
signed-out visitors see a "Try the demo" entry point, `isDemo` state switches which API route
`handleGenerate` posts to, and a persistent "Demo Mode" banner stays visible so it's never ambiguous
which mode produced a downloaded file. `/?demo=1` deep-links straight into it for the portfolio site.

## Auth

OAuth2 via Google, configured as a **web application** client type (authorized redirect URI on the
Vercel domain + localhost for dev) — not the old "Desktop app" client type. NextAuth.js manages the
session in an encrypted cookie and handles access token refresh using the stored refresh token. No
local token file, no database.

## Libraries

`next`, `next-auth`, `googleapis`, `cheerio`, `exceljs`, `date-fns` (or `chrono-node` for free-form
date phrases).
