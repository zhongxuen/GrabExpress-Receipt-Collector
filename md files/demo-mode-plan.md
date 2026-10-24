# Plan: Demo Mode (no sign-in, sample data)

## Why

The app requests the sensitive/restricted `gmail.readonly` scope, so until (and unless) it passes
Google's full OAuth verification + CASA security assessment, real sign-in only works for accounts
added as **test users** (see `adding-test-users.md`) — that doesn't scale to anonymous portfolio
traffic. Demo Mode sidesteps this entirely: portfolio visitors run the *real* parse/export
pipeline against a small bundled set of sample GrabExpress emails, with no Google sign-in and no
access to any real Gmail account. It proves the tool works without needing verification, test-user
allowlisting, or a visitor's real inbox.

Non-goal: this does not replace the OAuth verification track — that's still needed for anyone who
wants to run the tool against their own inbox. Demo Mode is purely a portfolio showcase path.

## Design

Reuse the existing pipeline exactly as-is — `parseGrabExpressReceipt` (`lib/receiptParser.ts`) and
`buildReceiptWorkbook` (`lib/exporter.ts`) stay untouched. Only the *input source* changes: instead
of `searchMessages`/`fetchMessageContent` hitting the Gmail API, a demo route feeds in bundled
fixture HTML. This is important for credibility — the demo is exercising the same parser and
exporter as the real feature, not a mocked-up fake.

```
Real flow:   Gmail API  →  parseGrabExpressReceipt  →  buildReceiptWorkbook  →  .xlsx
Demo flow:   fixtures[]  →  parseGrabExpressReceipt  →  buildReceiptWorkbook  →  .xlsx
```

## New files

### `lib/demoFixtures.ts`
A small array of synthetic sample messages, each shaped like `MessageContent` (`html`,
`fromHeader`) plus a fake `messageId`. Needs:
- At least one **Original** source receipt (direct `no-reply@grab.com` sender).
- At least one **Forwarded** receipt (to demonstrate the `Original`/`Forwarded` source column —
  the real inbox pattern documented in `CLAUDE.md` and `grabexpress_receipts_raw.md`).
- One deliberately malformed message (missing booking code) so the demo also shows the
  skipped-message UI, not just the happy path.
- Spread across a few different dates, so date-range filtering has something to actually filter.

Do **not** reuse the raw HTML captured in `grabexpress_receipts_raw.md` verbatim — it contains a
real person's Gmail address (`jayywoo@gmail.com`) and a real Gmail message ID. Write new fixture
HTML modeled on that structure but with invented names/emails/booking codes/amounts.

### `app/api/demo-export/route.ts`
Mirrors `app/api/export/route.ts` but:
- No `getServerSession`/auth check — publicly callable.
- Takes the same `DateRangeInput` body and reuses `buildGmailQuery` only for its date-filtering
  logic (or a simpler local date filter over the fixture list — Gmail query syntax itself is
  irrelevant to in-memory fixtures).
- Filters `lib/demoFixtures.ts` by date instead of calling `searchMessages`/`fetchMessageContent`.
- Runs the same `parseGrabExpressReceipt` → dedupe → `buildReceiptWorkbook` steps.
- Returns the same response shape (`X-Export-Meta` header, `.xlsx` attachment) so the frontend
  needs almost no branching.
- Filename: `grabexpress_receipts_demo.xlsx` (never reuse the real filename — avoid any confusion
  in a downloads folder between a demo file and a real export).

### Basic abuse guard
No real Gmail account or external API is touched, so the risk is just wasted compute, not
credential misuse — but still add a light per-IP rate limit (e.g. a simple in-memory token bucket
keyed on `x-forwarded-for`, reset periodically) on `/api/demo-export` since it has no auth gate at
all. Vercel Functions are stateless per-instance, so this is best-effort, not a hard guarantee —
sufficient for a portfolio demo, not for a public API meant to withstand abuse.

## UI changes (`app/page.tsx`)

- Add a **"Try the demo"** entry point visible whenever the visitor is signed out, alongside the
  existing "Sign in with Google" card — e.g. a secondary button or link: *"Just want to see how it
  works? Try the demo with sample data — no sign-in required."*
- Clicking it reveals the same `DateRangePicker` + "Generate spreadsheet" UI already built, but
  wired to call `/api/demo-export` instead of `/api/export`, with `isDemo` local state controlling
  which endpoint `handleGenerate` posts to.
- Show a persistent small banner/badge while in demo mode ("Demo Mode — sample data, not your real
  inbox") so it's never ambiguous which mode is active, especially after downloading a file.
- Reuse the existing loading/progress/result/skipped-message UI unchanged — it already renders
  generically off `ResultMeta`.

## Portfolio integration

- Deep-link directly into demo mode from the portfolio site, e.g. `https://<app>.vercel.app/?demo=1`
  — `page.tsx` reads that query param on mount and pre-selects the demo view so visitors land
  straight in it with zero extra clicks.
- Portfolio copy should set expectations: "sample data" or "demo," not "try it live," to avoid
  implying it works on the visitor's own inbox.

## Testing plan

1. `npm run typecheck` / `next build` still pass.
2. Manually hit `/api/demo-export` with each date-range mode (all time / since / month / custom /
   free-form) and confirm fixture filtering matches expectations.
3. Confirm the malformed fixture message shows up in the response's `skipped` list with a
   sensible reason string, exactly like a real parse failure would.
4. Confirm the downloaded workbook's `Original`/`Forwarded` column, date formatting, and amount
   column look correct against the fixture data.
5. Click through the UI end-to-end signed out: land on page → "Try the demo" → pick a range →
   generate → file downloads → skipped list (if any) renders.
6. Confirm the real `/api/export` + sign-in flow is completely unaffected (no shared mutable
   state between the two routes).

## Out of scope / later

- OAuth verification + CASA assessment for real multi-user usability (separate track, see prior
  discussion — not blocked by or blocking this plan).
- Persisting or logging demo usage — none needed; it's stateless per-request like the real export.
