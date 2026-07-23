# GrabExpress Receipt Collector

Local CLI tool that authenticates with Gmail via the official Gmail API, finds
GrabExpress receipt emails, parses receipt data out of the email HTML, and
exports the results to a formatted `.xlsx` file.

## Setup

1. Install dependencies:

   ```
   pip install -r requirements.txt
   ```

2. Get Gmail API credentials from the
   [Google Cloud Console](https://console.cloud.google.com/):
   - Create (or pick) a project, enable the **Gmail API**.
   - Create an OAuth client ID of type **Desktop app**.
   - Download the resulting JSON and save it in this folder as
     **`credentials.json`** (same directory as `main.py`).

   `credentials.json` holds your OAuth client ID and client secret — put both
   in that one file, there's nowhere else they need to go.

3. Run the tool once to trigger the browser login:

   ```
   python main.py
   ```

   A browser window opens for you to log into Gmail and grant read-only
   access. On success, a `token.json` is written automatically in this
   folder — subsequent runs reuse it without asking you to log in again.

## Usage

```
python main.py                              # all receipts
python main.py --since 2026-06-01
python main.py --month 2026-06
python main.py --from 2026-06-01 --to 2026-06-30
python main.py --when "last 90 days"
python main.py --when "last year"
python main.py --when "2025"
python main.py --when "this month"
python main.py --when "June 2026"
```

Output files are written to `outputs/grabexpress_receipts[_<range>].xlsx`.
Logs (search query, receipts found, skipped parsing failures) are written to
`logs/<YYYY-MM-DD>.log`.

## Files you don't need to touch

- `credentials.json` — your OAuth client ID/secret, downloaded from Google
  Cloud Console (see Setup above). **Not included in this repo — add it
  yourself.**
- `token.json` — generated automatically after your first successful login.
  Delete it to force re-authentication.

Both are local secrets and should never be committed to version control.
