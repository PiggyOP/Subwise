# Setu AA sandbox integration

This is a direct, server-side Setu AA v2 **sandbox** integration. It does not enable production bank access, credit-card purchase feeds, UPI mandate management, or subscription cancellation. Separate card/UPI connection controls and session creation have been removed. Historical records and ingestion compatibility are preserved.

## Configuration

Set server environment variables `SETU_SANDBOX_ENABLED=true`, `SETU_CLIENT_ID`, `SETU_CLIENT_SECRET`, `SETU_PRODUCT_ID`, `SETU_SANDBOX_EMAILS` (comma-separated exact email addresses) and `SETU_WEBHOOK_TOKEN` (at least 32 random characters). Keep secrets in the host's secret environment store; never in browser code, source control, logs, or screenshots. The existing Plus check still applies.

In Bridge, set the **test** callback URL to `https://<app-host>/api/webhooks/setu/<SETU_WEBHOOK_TOKEN>`. Do not use the homepage or the generic `/api/webhooks/financial` contract. Disable auto-fetch for this integration; Subwise creates one data session after approval and recovers an existing provider session before attempting creation.

## User journey

The allowlisted test account sees **Connect a test bank** in Accounts, prefilled with dummy number `9999999999`. Subwise explicitly routes to `9999999999@finvu` through Setu, and stores only a keyed digest of the full VUA to reuse the correct pending request. Including the AA handle prevents reuse of old OneMoney/Anumati requests. OTPs stay on the provider screen. Setu support ticket **143012** supplied Finvu UAT login OTP **111111** and consent OTP **123456** on 31 October 2026; these codes apply to this test flow, not production.

The consent requests up to 89 days of history, DEPOSIT transactions only, purpose 102 (spending/budget analysis), STORE, one-month data life, daily maximum fetch frequency, and one-month consent duration. Explicit fields avoid relying on incomplete Bridge defaults. The AA handle is explicitly Finvu, as directed by Setu support. Only Setu sandbox/UAT HTTPS authorization origins are accepted. Select mock FIPs, never real accounts, for sandbox testing.

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

Hosted verification (updated 30 October 2026): Setu support confirmed that its API accepts Indian source IPs only. Moving the Vercel API to Mumbai (`bom1`) resolved HTTP 403; hosted consent creation now succeeds. This verifies API connectivity, not completed bank linking or transaction retrieval. The Bridge test callback still points to Beeceptor pending configuration; polling works independently.

### Provider identity troubleshooting history

The user requires a Setu-hosted test-number/OTP flow without a personal phone. The separate Subwise simulator was reverted and its legacy rows are excluded from workspace reads; they must not be presented as Setu results.

Fresh provider checks on 30 October 2026:

- Token API and `GET /v2/fips?status=ACTIVE` return HTTP 200. Both `setu-fip` and `setu-fip-2` are ACTIVE.
- The old documented example `9999999999@setu-aa` returns HTTP 400 `InvalidRequest`: entity handle `setu-aa` is not supported. Trace `1-6ae4791f-4d24d664227bf6470984594e`.
- The currently documented `9999999999@setu` returns HTTP 500 `UpstreamInternalServerError`. Trace `1-6ae47938-5e0abbf70dea85e226688531`.
- The unsuffixed example routes to a partner AA login. A dummy number is not proof of a provisioned login. The current guide's static `123456` applies to Setu FIP-2 bank linking; do not claim it also authenticates the partner AA login.

On 31 October, Setu support supplied Finvu UAT OTPs (ticket 143012). Both a direct request and the deployed Subwise app successfully created a consent for `9999999999@finvu` and opened a Finvu login. The user confirmed test PIN `1234`; a live reproduction accepted login OTP `111111` and PIN `1234`, then displayed **Confirm your PAN**, referring to investments, with an empty PAN input and disabled/spinning Continue button. The menu contains FAQs, language and cancel, with no skip option. No PAN was entered and no PIN was reset.

A separate diagnostic consent (`1fcc58fd-5ff8-4948-9b7d-4a49baa45aa1`) used only `DEPOSIT`, `TRANSACTIONS` and documented context `[{"key":"fipId","value":"setu-fip-2"}]`. Setu accepted this narrower request and the login displayed Setu FIP 2, but it still reached the same PAN step after successful OTP/PIN. The main app consent is `32656519-755a-49ac-9016-b27cdcf70c5a`. No consent approval or financial-data fetch has been verified. The UI did not expose a skip control or a useful error; the exact provider-side cause remains unconfirmed.

Setu's support article [Custom Financial Data Generation in Setu Mock FIPs](https://support.setu.co/support/solutions/articles/81000417391-custom-financial-data-generation-in-setu-mock-fips) documents provider-side custom account/data upload and preset scenarios. Obtain the applicable API contract/access before using these; app-inserted subscriptions do not verify this integration.
