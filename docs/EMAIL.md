# Optional email delivery

Email verification is optional. Sign-in and dashboard access do not require it. Email-provider onboarding is on hold at the owner's request. No email service is configured locally, and no customer email has been sent.

The profile behind the top-right avatar saves the account email and monthly-summary preferences. Monthly summaries require both a verified email and explicit opt-in. Changing a linked email requires the current password and successful verification of the new address.

## Existing Resend adapter (inactive)

The backend has an optional Resend REST adapter. To enable it later, create a provider account, verify a domain you own, create a sending API key, then configure server-only environment variables:

- `RESEND_API_KEY`: the sending API key.
- `EMAIL_FROM`: a sender at your verified domain.
- `EMAIL_UNSUBSCRIBE_SECRET`: a random, persistent secret for signed unsubscribe links.
- `APP_ORIGIN`: the deployed HTTPS app address.

Keep credentials in the deployment secret store or the ignored local `.env`, never in chat, source control, or mobile/web bundles. Restart the backend after configuration. The provider account must remain on the desired free plan; provider quotas apply. No automatic paid upgrade is implemented by Subwise. A domain may have a separate cost. No Firebase integration was added.

Verification codes expire after 10 minutes, allow at most five guesses, and have resend rate limits. Codes are hashed in the database and are not returned through the API. Provider acceptance does not prove inbox delivery.

## Monthly summaries

The running backend checks for due summaries once a minute. The customer chooses a day from 1–28; sending is scheduled for 09:00 Asia/Kolkata. Keep the backend running with persistent SQLite storage. An external scheduler may instead run `node scripts/send-monthly-emails.js` against the same database.

The outbox stores immutable snapshots, uses provider idempotency keys, retries temporary failures, and checks verification and preferences before sending. Users can unsubscribe through a signed confirmation link or their profile. Monthly email is not a bank statement. Verify delivery, unsubscribe behavior, quotas and scheduling against the actual provider before release.
