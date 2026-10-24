# Guide: Adding Test Users for Google OAuth Sign-In

## Why this is needed

This app requests the sensitive `gmail.readonly` scope (see `CLAUDE.md`). Until the OAuth
consent screen passes Google's verification review, the app stays in **Testing** publishing
status, and Google Sign-In will only work for Gmail accounts explicitly added as **test users**
in the Google Cloud project. Any other account that tries to sign in will be blocked with an
"Access blocked: this app's request is invalid" or "hasn't completed the Google verification
process" screen.

Test users can be **any Gmail address** — they don't need to be added to the Google Cloud
project as project members/IAM users, and no other permissions are granted to them beyond being
allowed to complete the OAuth consent flow.

## Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select the project used for this app's OAuth client (the one whose Client ID/Secret are set
   as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
3. Navigate to **APIs & Services → OAuth consent screen**.
4. Scroll to the **Test users** section (or open the **Audience** tab, depending on the current
   console layout).
5. Click **+ Add users**.
6. Enter the Gmail address(es) to allow, one per line (up to 100 test users total on the free
   tier).
7. Click **Save**.

Changes take effect immediately — no redeploy or restart needed. The newly added address can
sign in right away.

## Verifying it worked

1. Open the app (locally at `http://localhost:3000` or the Vercel deployment URL).
2. Click **Sign in with Google**.
3. Sign in with the newly added test user's Gmail account.
4. You should land on the Google account chooser → consent screen (showing the "Google hasn't
   verified this app" warning, which is expected pre-verification — click **Continue**) → back to
   the app, signed in.
5. If the account still gets blocked, double-check:
   - The email was added under the **same** Google Cloud project as the OAuth client.
   - There's no typo in the email address.
   - The OAuth consent screen's **Publishing status** is still "Testing" (if it's already
     "In production" and verified, the test-user allowlist no longer applies — anyone can sign
     in).

## Removing a test user

Same location (**OAuth consent screen → Test users**) → click the trash/remove icon next to the
email → **Save**.

## Notes

- Test user limit is 100 accounts while the app is unpublished/unverified.
- Google Workspace organizer accounts may have their own admin restrictions on third-party apps
  that can override this list — if a Workspace user still can't sign in, check with their
  Workspace admin.
- This list is unrelated to `.env.local` / Vercel environment variables — it's managed entirely
  in the Google Cloud Console, not in the codebase.
