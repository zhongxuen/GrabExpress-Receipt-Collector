# Task: Debug Gmail API Returns 0 GrabExpress Receipts

## Problem

The application successfully:

- Authenticates with Google OAuth
- Connects to the Gmail API
- Generates and exports the Excel file

However, it always reports **0 receipts found**, even though the authenticated Gmail account contains many GrabExpress receipt emails.

Manual Gmail search using the following query returns the expected receipts:

```text
from:no-reply@grab.com subject:"Your GrabExpress Receipt"
```

Therefore, the issue is **not simply that the account has no matching emails**. We need to identify exactly where the pipeline is failing.

---

# Objectives

Perform a systematic investigation and fix the root cause instead of guessing.

---

# Investigation Steps

## 1. Verify Gmail API Search

Locate the code that calls:

- `gmail.users.messages.list()`

Temporarily add detailed logging:

- The exact query (`q`) being sent
- Full API response
- Number of messages returned
- Any `nextPageToken`

Example information to log:

- Gmail query
- messages length
- response data
- authenticated email address

Do **not** remove these logs until the issue is resolved.

---

## 2. Verify Authenticated Account

Log the authenticated Gmail account using:

```ts
gmail.users.getProfile({
  userId: "me"
})
```

Ensure it matches the account containing the receipts.

---

## 3. Compare Gmail UI vs Gmail API

If Gmail UI returns receipts but Gmail API returns zero:

Investigate:

- query formatting
- escaping
- whitespace
- quotes
- OAuth scopes
- Gmail API request parameters

Verify the API is sending **exactly** the intended query.

---

## 4. If Messages Are Returned

If Gmail API successfully returns message IDs:

Determine where they disappear.

Log:

- number of message IDs
- number of downloaded messages
- number successfully parsed
- number rejected

This will isolate whether the issue is:

- search
- download
- parser
- filtering

---

## 5. Verify Message Download

Inspect:

```ts
gmail.users.messages.get(...)
```

Ensure messages are retrieved using the correct format (`full` if required).

Log:

- message id
- subject
- from
- snippet

for several messages.

---

## 6. Verify HTML Extraction

Grab receipts are HTML emails.

Inspect the payload structure.

Ensure the parser correctly handles:

- payload.body
- payload.parts
- nested multipart structures

If necessary, improve the HTML extraction utility to recursively locate the HTML body.

---

## 7. Verify Receipt Parser

If messages are successfully downloaded:

Determine why every message is rejected.

For every processed email, log:

- Subject
- Sender
- Whether parser accepted/rejected
- Reason for rejection

Avoid silent failures.

---

## 8. Check Additional Filters

Inspect the codebase for additional filtering such as:

- date range
- sender validation
- subject validation
- regex validation
- receipt number extraction
- amount extraction

Ensure valid receipts are not accidentally discarded.

---

## 9. Add Temporary Debug Summary

After execution, print a summary similar to:

```text
Authenticated Account:
Search Query:
Messages Found:
Messages Downloaded:
Messages Parsed:
Receipts Accepted:
Receipts Rejected:
Reason(s):
```

This should make future debugging significantly easier.

---

# Deliverables

- Root cause identified.
- Issue fixed without breaking existing functionality.
- Remove unnecessary debug logs after confirming the fix (leave only useful structured logging if appropriate).
- Briefly explain:
  - what the actual problem was,
  - why it happened,
  - and what changes were made to resolve it.