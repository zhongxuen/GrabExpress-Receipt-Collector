# GrabExpress Receipt Collector

Web app, deployed on Vercel, that lets any Gmail user sign in with Google, finds GrabExpress
receipt emails, parses receipt data out of the email HTML, and downloads the results as a
formatted `.xlsx` file.

See [`instructions.md`](instructions.md) for the full spec and [`CLAUDE.md`](CLAUDE.md) for an
implementation-oriented summary of the architecture.

## Stack

- Next.js (App Router), deployed on Vercel
- NextAuth.js for Google OAuth (`gmail.readonly` scope), session in an encrypted cookie — no
  database, no local token file
- `googleapis` for Gmail API search + fetching raw HTML message bodies
- `cheerio` for HTML parsing (CSS selectors, regex fallback)
- `exceljs` to build the `.xlsx` in memory and stream it back as a browser download

## Setup

1. Create a Google Cloud project, enable the **Gmail API**.
2. Create an OAuth client ID of type **Web application**, with an authorized redirect URI for both
   your Vercel deployment and `http://localhost:3000` (local dev).
3. Set environment variables (locally in `.env.local`, and in Vercel project settings):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (local dev only, e.g. `http://localhost:3000`)
4. `npm install`
5. `npm run dev`

## Usage

1. Open the site, click "Sign in with Google", grant read-only Gmail access.
2. Pick a date range (all time / since a date / a month / custom range / free-form phrase like
   "last 90 days").
3. Click "Generate spreadsheet" — the browser downloads
   `grabexpress_receipts[_<range>].xlsx` once the server finishes processing.

Since this app requests the sensitive `gmail.readonly` scope and allows any Google account to sign
in, the OAuth consent screen will show an "unverified app" warning (or be limited to added test
users) until it passes Google's verification review.
