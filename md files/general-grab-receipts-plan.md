# Plan: Expand from GrabExpress to general Grab receipts (GrabFood + GrabCar)

## Why

The app only searches `subject:"Your GrabExpress Receipt"` and only has a GrabExpress parser.
Most Grab spend is food delivery and rides, and those receipts arrive under a **different
subject** with **different HTML layouts**. `lib/receiptParser.ts` already has the extension point
for this (`BaseGrabReceiptParser`, `getParserForSubject`, the "GrabFood, GrabCar, GrabMart" note).
This plan fills it in.

Related docs: `grabexpress_receipts_raw.md` (the GrabExpress analysis this one mirrors),
`fix-scrape-bug.md` (why there's no `from:` filter), `demo-mode-plan.md` (fixtures must cover new
types).

---

## What the real inbox shows (gohzx2006@gmail.com, analyzed 2026-10-23)

Checked through the signed-in Gmail web UI. Mail from `grab.com` that matches "receipt" falls into
these groups:

| Group | Subject | Sender | Count seen | In scope? |
|---|---|---|---|---|
| GrabExpress | `Your GrabExpress Receipt` (often `Fwd:`) | `no-reply@grab.com` / forwarder | 2 | already supported |
| GrabFood: delivery | `Your Grab E-Receipt` | `no-reply@grab.com` | ~50 (Jun–Oct 2026, plus older ones) | **yes** |
| GrabFood: dine-in | `Your Grab E-Receipt` | `no-reply@grab.com` | 1 (2026-09-18) | **yes** |
| GrabCar ride | `Your Grab E-Receipt` | `no-reply@grab.com` | 46 (Sep 2024 – Feb 2026) | **yes** |
| GrabPay payment | `You've made a payment to <merchant> 🎉` | `no-reply@grab.com` | 34 | later (see Out of scope) |
| Marketing (newsletters, promos, "GrabCoins Flash Sale"…) | various | `no-reply@grab.com` | many | never |

Key takeaways:

- **Food and rides share one subject**, `Your Grab E-Receipt`, so the subject alone can't pick the
  parser. The body has to decide (see "Dispatch" below).
- **GrabMart: no samples in this inbox.** A search for `GrabMart`/`Mart` inside E-Receipts found
  only one GrabFood delivery receipt. GrabMart probably uses the GrabFood template (with
  `Vehicle type: GrabMart`?), but that's unverified. Don't claim support until a real sample is
  checked.
- No forwarded E-Receipts were seen. All of them came straight from `no-reply@grab.com`, so the
  existing `Original`/`Forwarded` logic applies unchanged.

### Template A: GrabFood delivery (the sample the user pasted)

Headline `Hope you enjoyed your food!`. Fields use the same label/value layout as GrabExpress
(`<span>label</span><br><span>value</span>` inside one `<td>`):

```html
<td width="44%">TOTAL<br> <span style="font-size:28px;...">RM 16.50</span></td>
<td width="56%">DATE&nbsp;&nbsp;|&nbsp; TIME<br> Pick-up time: <span ...>23 Oct 26 09:57 +0800</span></td>
...
<span ...>Vehicle type:</span><br> <span ...>GrabFood</span>
<span ...>Issued to</span><br> <span ...>{name}</span>
<span ...>Booking code</span><br> <span ...>A-AW6CS25GWXQSAV</span>
<span ...>Order location:</span><br> <span ...>Uncle Soon Fried Rice - Cheras Maluri [Non-Halal] </span>
<span ...>Delivery location:</span><br> <span ...>{home address}</span>
...
<span>Subtotal</span> … <span>&nbsp;&nbsp;RM 14.50 </span>
<span>Delivery fee</span> … <span>&nbsp;&nbsp;RM 2.00 </span>
<span>TOTAL (INCL. TAX)&nbsp;&nbsp;&nbsp;&nbsp;</span> … <span>&nbsp;&nbsp;RM 16.50</span>
```

- Receipt number: **Booking code** `A-…`, the same shape as GrabExpress, so `BOOKING_CODE_RE`
  already matches it.
- There's also an order ID `001577370156-C8KHDFBVTPCWWE`, but only inside the "Rate your meal"
  deep-link URLs. Don't use it: Booking code is visible and consistent with GrabExpress.
- Date: `Pick-up time: 23 Oct 26 09:57 +0800`. It has a 2-digit year (already handled) and a
  timezone suffix. The email arrives ~15–30 min after pick-up, and pick-up time is the
  transaction date to record.
- Amount: `RM 16.50`. It appears twice, in the header TOTAL and in `TOTAL (INCL. TAX)`.
- Zero totals exist (2026-07-22: `TOTAL RM 0.00`, presumably fully voucher-covered). They parse
  as `0`. Export them, don't skip them.

### Template B: GrabFood dine-in (scan-to-order at a restaurant)

Same shell and headline as delivery, but **different labels and no Booking code**:

```html
<td width="44%">TOTAL<br> <span ...>MYR 4.56</span></td>          <!-- MYR, not RM -->
DATE | TIME<br> <span ...>18 Sep 26 12:54 +0800</span>           <!-- no "Pick-up time:" -->
<span ...>Type of order:</span><br> <span ...>Dine-in</span>      <!-- not "Vehicle type:" -->
<span ...>Ordered by</span><br> <span ...>{name}</span>           <!-- not "Issued to" -->
<span ...>Order ID</span><br> <span ...>001490848944-C8E1A6W2FB3AEN</span>
<span ...>Restaurant:</span><br> <span ...>WATER BAR - Food City AEON Maluri 食满堂 </span>
<span ...>Table number:</span><br> <span ...>C13</span>
... Subtotal MYR 4.56 / incl. Tax MYR 0.26 / TOTAL (INCL. TAX) MYR 4.56
```

- Receipt number: **Order ID** `\d+-[A-Z0-9]+`. It does **not** match `BOOKING_CODE_RE`.
- Currency prefix is `MYR`. `AMOUNT_RE`/`AMOUNT_FALLBACK_RE` already accept `RM|MYR`.
- The `<span class="il">` around `MYR` in the Gmail web view is Gmail's search-term highlighting.
  It won't be in the raw API HTML, so don't depend on it either way.

### Template C: GrabCar ride (completely different, newer layout)

Div-based, no `<span>label</span><br><span>value</span>` pattern. Inline "label: value" text, and
a two-column `<tr>` for totals:

```html
<div style="white-space:nowrap">Standard (JustGrab)</div>        <!-- or "JustGrab", "Standard | Top-Rated Drivers" -->
... Hope you enjoyed your ride!
<div style="color:#fff">Picked up on 14 February 2026</div>      <!-- 4-digit year, full month -->
<div style="color:#fff;white-space:nowrap">Booking ID: A-8VSM8JHGW3KHAV</div>
<tr><td>Total Paid</td><td><div>RM 18.30</div></td></tr>         <!-- headline total -->
... Breakdown: Fare 18.00 / Ride Cover 0.30 / Total Paid 18.30   <!-- second "Total Paid", no RM -->
... Passenger {name} / Profile PERSONAL / Paid by GrabPay Wallet 18.30
... Your Trip 11.45 km • 29 mins / {pickup} 11:58AM / {dropoff} 12:27PM
```

- Receipt number: **Booking ID** `A-…`, the same shape as the GrabExpress booking code (older ones
  are shorter, e.g. `A-7HIFTBRGWHNM`, which still matches `{8,}`).
- The 2024 and 2026 ride receipts use the same template. The only difference between their Gmail
  previews is snippet truncation.
- Date: `Picked up on 14 February 2026`. `DATE_CANDIDATE_RE`'s first alternative already handles
  this format.

---

## How the current parser does on each (probed 2026-10-23)

Ran `GrabExpressReceiptParser` against trimmed copies of each template:

| Template | Result | Why |
|---|---|---|
| A: food delivery | ✅ `2026-10-23 / A-AW6CS25GWXQSAV / 16.5` | Works, partly by luck: `/\bdate\b/` hits `DATE \| TIME`, returns the junk value `"\| TIME"`, then the whole-document fallback finds the first date-shaped string. |
| B: dine-in | ❌ `Booking Code not found` | No "Booking code" label, and the Order ID doesn't match `BOOKING_CODE_RE`. |
| C: ride | ⚠️ works **only** when tags are whitespace-separated | `/booking\s*code/` doesn't match "Booking ID", so it relies on the whole-text regex. `$.root().text()` concatenates adjacent block elements with no separator (`…A-8VSM8JHGW3KHAVTotal Paid`), which kills the trailing `\b`. Real email HTML usually has newlines between tags, but this is fragile. |

So for each type, the plan swaps "works by fallback" for explicit labels.

---

## Design

### 1. Search query (`lib/dateFilters.ts`)

Replace `GRABEXPRESS_SEARCH_BASE` with a union of the receipt subjects:

```
(subject:"Your GrabExpress Receipt" OR subject:"Your Grab E-Receipt")
```

- Still no `from:` filter, for the same reasons as before (see `fix-scrape-bug.md`). Both phrases
  are specific enough on their own.
- Rename the constant to `GRAB_RECEIPT_SEARCH_BASE` and update its comment.
- Optional service filter (see UI section): narrow the query instead of filtering after the
  fetch, which saves Gmail API calls and request time. Gmail's full-text search can tell food
  from rides (verified: `-"enjoyed your food"` returns exactly the ride receipts):
  - GrabExpress only: `subject:"Your GrabExpress Receipt"`
  - GrabFood only: `subject:"Your Grab E-Receipt" "enjoyed your food"`
  - Rides only: `subject:"Your Grab E-Receipt" "enjoyed your ride"`
  - Several services: OR the clauses together.
  - The parser still records the real service type, so a mis-match in the query doesn't corrupt
    data. At worst a receipt is missed, and the default "all" filter avoids that.

### 2. Shared parsing fixes (`BaseGrabReceiptParser`)

- **Text flattening:** when building `text` in `load()`, separate block-level elements with a
  space (e.g. join text nodes with `" "`, or insert a space after each `</div>`, `</td>`, `<br>`
  before calling `.text()`). This fixes the `\b` failure above for every parser, not just rides.
- **`findValueNearLabel` per-type labels:** keep the helper as is. Each subclass passes its own
  label regexes. No changes to its proximity logic are needed. The probe confirmed it already
  handles all three shapes: label and value in one text node (`Booking ID: A-…`), value as a
  sibling `<span>` (food), and value in a sibling `<td>` (ride `Total Paid`).
- Move `BOOKING_CODE_RE`, `AMOUNT_RE`, `AMOUNT_FALLBACK_RE`, and `parseDateCandidate` up to the
  base class or module scope so all three parsers share them.

### 3. New parsers (`lib/receiptParser.ts`)

**`GrabFoodReceiptParser`** handles templates A and B:

| Field | Label regex (tried in order) | Value check | Fallback |
|---|---|---|---|
| receiptNo | `/booking\s*code/i`, then `/order\s*id/i` | `BOOKING_CODE_RE`, then `ORDER_ID_RE = /\b\d{6,}-[A-Z0-9]{8,}\b/` | whole text with the same regexes |
| amount | `/total\s*\(incl\.?\s*tax\)/i`, then the header `/^\s*total\s*$/i` | `AMOUNT_RE` | `AMOUNT_FALLBACK_RE` (currency required) |
| date | `/date\s*\|\s*time/i` (take the container's text, minus `Pick-up time:`) | `parseDateCandidate` | whole text |
| orderType | `/vehicle\s*type/i`, then `/type\s*of\s*order/i` | as-is: `GrabFood`, `Dine-in`, maybe `GrabMart` | `"GrabFood"` |
| merchant | `/order\s*location/i`, then `/restaurant/i` | trimmed text | empty |

For the date row, `findValueNearLabel` returns the stripped own-text `"| TIME"`. Instead, look up
the label's container `<td>` and run `parseDateCandidate` on its full text. A small
`findContainerText(labelPattern)` helper covers this and is cleaner than special-casing.

**`GrabTransportReceiptParser`** handles template C:

| Field | Label regex | Value check | Fallback |
|---|---|---|---|
| receiptNo | `/booking\s*id/i` | `BOOKING_CODE_RE` | whole text |
| amount | `/total\s*paid/i` (first match is the headline `RM 18.30`) | `AMOUNT_RE` | `AMOUNT_FALLBACK_RE` |
| date | `/picked\s*up\s*on/i` | `parseDateCandidate` | whole text |
| rideType | the text node just before the headline (`Standard (JustGrab)`), or a regex for `/\b(Just\|Grab)\w*\b/` | trimmed | `"GrabCar"` |

Don't use `/\bdate\b/` for rides. The template has no "Date" label, and the footer's
`© Grab 2026` is a trap for loose year matching.

**Keep `GrabExpressReceiptParser` unchanged** apart from inheriting the shared fixes. Its behavior
against `grabexpress_receipts_raw.md` must not change.

### 4. Dispatch: picking the parser

Subject alone can't tell food from rides, so dispatch has two steps:

```ts
export function parseGrabReceipt(html, messageId, fromHeader, subject): Receipt
```

1. If the subject contains `GrabExpress`, use `GrabExpressReceiptParser`.
2. If it contains `Grab E-Receipt`, sniff the body:
   - `/enjoyed your ride/i`, or a `Booking ID:` label plus `Picked up on`, means
     `GrabTransportReceiptParser`.
   - `/enjoyed your food/i`, or a `Vehicle type:` / `Type of order:` label, means
     `GrabFoodReceiptParser`.
   - Neither matches: throw `ReceiptParseError("Unrecognised Grab E-Receipt layout")`. This shows
     up in the skipped list, so a new GrabMart/GrabBike variant gets noticed instead of misparsed.
3. No subject available (headers missing): fall back to the same body sniff, with the GrabExpress
   headline `Your item has been delivered!` added as a third signature.

Body sniffing should be the main signal rather than the subject. The subject only narrows the
choice. That keeps forwarded mail working, since a `Fwd:` subject still contains the phrase.

`gmailClient.fetchMessageContent` needs to return the `Subject` header next to `From`. It comes
from the same `format: "full"` response, so there's no extra API call.

Keep `parseGrabExpressReceipt` as a thin export for one release (or delete it if only the two
routes use it; grep says they're the only callers).

### 5. Data model and spreadsheet (`lib/types.ts`, `lib/exporter.ts`)

Add one required field and one optional field to `Receipt`:

```ts
service: string;   // "GrabExpress" | "GrabFood" | "GrabFood (Dine-in)" | "GrabCar – Standard (JustGrab)" | …
merchant?: string; // restaurant for food; empty for rides/express
```

New column order: **Date | Receipt Number | Service | Merchant | Amount | Source**.

- `Service` is the most useful addition. Once rides and food share one sheet, the user will want
  to filter or pivot by it, for example to claim only rides as work expenses.
- `Merchant` is cheap to extract and useful for food expense claims. Don't add the
  pickup/dropoff addresses: they're the user's home address and more personal data than the
  sheet needs.
- Keep `receiptNo` as the dedupe key. Booking codes, booking IDs, and order IDs can't collide
  across types.
- Optional: freeze the header row and turn on the autofilter (`sheet.autoFilter`) so the Service
  column can be filtered straight away.

### 6. Routes

`app/api/export/route.ts` and `app/api/demo-export/route.ts`:

- Call `parseGrabReceipt(html, messageId, fromHeader, subject)` instead of
  `parseGrabExpressReceipt`.
- Filename `grab_receipts[_<range>].xlsx` (demo: `grab_receipts_demo.xlsx`). Keep the "never reuse
  the real filename for demo" rule.
- Pass the optional `services` filter through to `buildGmailQuery`.
- **Volume:** this inbox goes from 2 matches to ~100. Concurrency 8 is still well within
  `maxDuration = 60`, but heavy users with years of daily GrabFood could have 1000+. Consider
  raising `maxDuration` (the Vercel default is now 300s), and keep the "Progress Display" idea
  from `instructions.md` on the radar. No change is required for this plan.

### 7. UI (`app/page.tsx`, `app/layout.tsx`)

- Rename the copy from "GrabExpress Receipt Collector" to "Grab Receipt Collector", and update
  the subtitle and progress text ("Searching Gmail for Grab receipts…").
- Add a **service filter** (checkbox group, all checked by default): GrabExpress, GrabFood,
  Rides. Send it as `services: ("express" | "food" | "transport")[]` in the request body,
  alongside `DateRangeInput`.
- Result summary: break the count down by service ("Exported 97 receipts: 50 GrabFood,
  45 rides, 2 GrabExpress").
- The skipped list is unchanged. It's where unrecognised layouts will show up.

### 8. Demo fixtures (`lib/demoFixtures.ts`)

Add invented fixtures modeled on templates A, B, and C:

- 2× GrabFood delivery (one with `RM 0.00`, to show the zero-total case)
- 1× GrabFood dine-in (`MYR`, Order ID)
- 2× rides (different dates and ride types)
- Keep the existing GrabExpress fixtures and the malformed one.

**Don't** copy real values from the user's mailbox into fixtures or into any committed file:
their name, the Residensi/home delivery address, driver names, real booking codes, or real order
IDs. The same rule applied in `demo-mode-plan.md`.

### 9. Docs

- `CLAUDE.md`: update "What this project is", the Gmail search query section (union query,
  body-sniff dispatch, why food and rides share a subject), and the parser list.
- The project/repo name ("GrabExpress-Receipt-Collector") can stay for now. Renaming the Vercel
  project or domain is a separate decision.

---

## Implementation order

1. Shared fixes in `BaseGrabReceiptParser` (text flattening, shared regexes) → re-verify the
   GrabExpress fixtures parse identically.
2. `GrabFoodReceiptParser` + `GrabTransportReceiptParser` + `parseGrabReceipt` dispatch.
3. `gmailClient`: return `subject`.
4. `types.ts` / `exporter.ts`: `service` + `merchant` columns.
5. Routes: new dispatch function, filename, query union.
6. Demo fixtures for the new templates.
7. UI copy + service filter + per-service counts.
8. `CLAUDE.md` update.

Steps 1–5 alone deliver the feature. Steps 6–8 are polish and can ship in a follow-up.

## Testing plan

1. `npm run typecheck`, `npm run lint`, `next build`.
2. Parser probe: a scratch script run with `npx tsx` that feeds each template (A, A with RM 0.00,
   B, C, existing GrabExpress, malformed) through `parseGrabReceipt`. Assert date, receiptNo,
   amount, and service. Include the "no whitespace between tags" variant of C to prove the
   flattening fix. (The repo has no test runner. Adding `vitest` is fine if you want this kept as
   a permanent test, not a one-off.)
3. **Before trusting the real export:** pull one raw message per template through the Gmail API
   (or Gmail → "Show original"). Confirm the raw MIME HTML has the same labels as the rendered
   view analyzed above. The pasted sample is the Gmail-rendered DOM (images rewritten to
   `googleusercontent` proxies, Adobe extension markup injected), not the exact bytes the parser
   receives.
4. Real export against gohzx2006@gmail.com for "all time". Expect roughly 50+ GrabFood,
   46 rides, and 2 GrabExpress, with **0 skipped**. Spot-check against Gmail:
   - 2026-10-23 → `A-AW6CS25GWXQSAV`, 16.50, GrabFood, Uncle Soon Fried Rice…
   - 2026-09-18 → `001490848944-C8E1A6W2FB3AEN`, 4.56, GrabFood (Dine-in), WATER BAR…
   - 2026-07-22 → amount 0.00 (present, not skipped)
   - 2026-02-14 → `A-8VSM8JHGW3KHAV`, 18.30, GrabCar – Standard (JustGrab)
   - 2024-10-02 → `A-6VHNPT9WWG22`, 6.30 (older ride, short booking ID)
5. Service filter: "Rides only" returns only ride rows and the Gmail match count drops to match.
6. Demo mode signed out: all new fixture types appear and the malformed one is still skipped.

## Out of scope / later

- **GrabPay payment receipts** (`You've made a payment to <merchant>`): a different product
  (in-store QR/online payments), with no date in the body (you'd need the email's `Date` header
  or `internalDate`), a hex `Transaction ID` as the receipt number, and the merchant only in the
  subject/body heading. Spot-checked: these do **not** duplicate GrabFood receipts (e.g. the
  2026-10-15 GrabPay payment was RM 20.00 vs that day's RM 18.20 food order), so adding them later
  wouldn't double-count. They would need a `fetchMessageContent` change to also return the `Date`
  header.
- **GrabMart, GrabBike, GrabCar Plus/Premium, Advance Booking, cross-border JB↔SG** variants:
  the dispatch's "Unrecognised layout" skip reason will surface them. Add parsers once a real
  sample exists.
- Non-Malaysian receipts (SGD, etc.): the current amount regexes only accept `RM|MYR`. Fine for
  this user. A multi-country version would need currency as its own column.
- Line items (individual dishes, delivery fee, ride cover): possible from the same HTML, but
  they turn a one-row-per-receipt sheet into a second sheet. Not needed for expense tracking.
