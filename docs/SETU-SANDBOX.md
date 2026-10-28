# Setu AA sandbox integration

This is a direct, server-side Setu AA v2 **sandbox** integration. It does not enable production bank access, credit-card purchase feeds, UPI mandate management, or subscription cancellation. Separate card/UPI connection controls and session creation have been removed. Historical records and ingestion compatibility are preserved.

## Configuration

Set server environment variables `SETU_SANDBOX_ENABLED=true`, `SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_ID`, `SETU_SANDBOX_EMAILS` (comma-separated exact email addresses) and `SETU_WEBHOOK_TOKEN` (at least 32 random characters). Keep secrets in the host's secret environment store; never in browser code, source control, logs, or screenshots. The existing Plus check still applies.

In Bridge, set the **test** callback URL to `https://<app-host>/api/webhooks/setu/<SETU_WEBHOOK_TOKEN>`. Do not use the homepage or the generic `/api/webhooks/financial` contract. Disable auto-fetch for this integration; Subwise creates one data session after approval and recovers an existing provider session before attempting creation.

## User journey

The allowlisted test account sees **Connect a test bank** in Accounts. The user enters a mobile number registered for sandbox testing. Subwise sends it to Setu for the consent journey and stores only a keyed digest to reuse the correct pending request. OTPs stay on the provider screen. A dummy number requires current provider-supplied login instructions; the old migration guide's `123456` OTP was rejected by the current Anumati login for `9999999999`.

The consent requests up to 89 days of history, DEPOSIT transactions only, purpose 102 (spending/budget analysis), STORE, one-month data life, daily maximum fetch frequency, and one-month consent duration. Explicit fields avoid relying on incomplete Bridge defaults. No AA handle is forced. Only Setu sandbox/UAT HTTPS authorization origins are accepted. Select mock FIPs, never real accounts, for sandbox testing.

The user completes the provider's test login/account/consent flow. Returning to Subwise opens Accounts. The visible page checks progress at most once a minute; a scheduled job checks pending connections every five minutes. The server obtains a bearer token from Setu's token service, verifies consent with Setu, creates/reconciles the session, retrieves JSON and normalizes debit transaction amounts to integer paise. Provider account and transaction IDs namespace duplicate protection. Existing recurrence detection then runs on actual provider-returned sample transactions. No subscriptions are fabricated to fill an empty result.

The first approved consent scans its fixed history range. This sandbox version retrieves/reconciles that initial session; it does not automatically extend the consent's history window or create daily new data sessions. Fewer than three matching monthly charges will not produce a detected subscription. An 89-day statement cannot establish annual recurrence on its own. Setu's sample dataset may contain no recognizable subscriptions.

## Security and lifecycle

- Bank records use source `setu_sandbox` and payment label `Bank · sandbox`. A workspace notice identifies all sample totals as test finances. Each consent/session is mapped to the authenticated Subwise user; ordinary users cannot start the sandbox.
- The secret callback path is defense in depth. Callback bodies are **untrusted hints**, not authorization: callback fields can only schedule reconciliation. Status and transaction data are fetched via authenticated Setu APIs, with consent/session ID checks, before applying changes. A forged callback cannot insert financial data or approve consent.
- HTTP redirects are refused when transmitting provider credentials. Timeouts and non-JSON/invalid responses are surfaced without copying provider bodies or secrets into client errors.
- Concurrent syncs use a database lease. An ambiguous data-session POST is marked attempted and reconciled through the provider's session list; it is not blindly replayed.
- Revoked/rejected/expired/paused consent stops ingestion. Previously detected records are marked for review. Financial transaction and derived sandbox subscription records are conservatively purged after 28 days. This cleanup requires the scheduled job or local worker to keep running. Account deletion also cascades connection records.
- This is not approval for production access. Production eligibility, consent policy, security/retention review, billing and coverage need separate onboarding.

## Troubleshooting and evidence

The earlier Postman Cloud Agent calls returned generic HTML 403 responses. Direct requests from the development computer successfully authenticated and returned a consent. Hard-coded `@setu` requests returned an upstream error. A request without the suffix but missing purpose settings returned `Consent parameters are not as per Fair Usage Policy for purposeCode:`. Explicit purpose 102 and limited parameters returned HTTP 201 with an Anumati sandbox consent URL. These observations establish a working request configuration, not a definitive diagnosis of the Cloud Agent's network rejection.

Reference: [Quickstart](https://docs.setu.co/data/account-aggregator/quickstart), [consent flow](https://docs.setu.co/data/account-aggregator/api-integration/consent-flow), [data flow](https://docs.setu.co/data/account-aggregator/api-integration/data-apis), [notifications](https://docs.setu.co/data/account-aggregator/api-integration/notifications), [OpenAPI](https://docs.setu.co/api-specs/data/account-aggregator.json).

Hosted verification: Netlify's request to `orgservice-prod.setu.co` returned HTTP 403 with a non-JSON response, while the same token request succeeds from the development computer. No consent has been created through the hosted backend and no bank transactions have been retrieved end to end. The Bridge callback still points to Beeceptor pending configuration; polling works independently. Provider approval of the hosting egress or a supported backend location is required before calling the hosted flow verified.
