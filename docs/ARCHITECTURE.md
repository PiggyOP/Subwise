# Architecture

The website and native React Native app share an authenticated Express API and a single-instance SQLite database. Financial amounts are integer INR paise. Browser sessions use HttpOnly cookies; native sessions use protected device storage and bearer tokens. Server session tokens are stored only as hashes. Every financial query is scoped to its authenticated owner.

## Connected-only data

Manual creation and CSV import are disabled at the public API and removed from both clients. Prices, merchant names and cadence cannot be manually edited. Only card/UPI source records appear in the subscription dashboard; legacy manually entered rows are not treated as connected data.

`connections` stores authorization state. `provider_transactions` stores transaction IDs unique per connection. Signed financial events are replay-protected and transactionally deduplicated. A successful browser return is not proof of connection. A verified connected event is required; revoked connections cannot silently reactivate.

Monthly/yearly subscriptions are created from either conservative transaction-pattern inference or explicit provider-identified recurring streams. The latter supports annual subscriptions without waiting for three annual observations. Normalized merchant aliases map the 120-service reference catalog to correct service names and local logo assets. Multiple streams, conflicting provider data, out-of-order changes and consent lifecycle handling require the contracted adapter's reconciliation logic before production.

The adapter contract is not a live bank or UPI integration. Its server-side request, redirect validation and signed ingestion boundary are described in `CONNECTIONS.md`. A real authorized partner must implement provider-specific authorization and APIs. Credentials stay server-side. No bank password, PAN, CVV, OTP or UPI PIN is collected in Subwise.

## Cancellation and AI

The cancellation engine accepts explicit in-app authorization for merchant-supported subscriptions, stores a durable job, dispatches it through a separately authorized adapter, and reconciles signed or authenticated provider confirmation. Unknown results remain pending and are checked with GET, rather than triggering blind duplicate POSTs. Users cannot manually set a cancelled status. Revoking a payment mandate and ending a merchant contract are distinct events. No live cancellation adapter is currently configured; see `CANCELLATION.md`.

The optional AI receives limited subscription context after user consent. Its tool prepares cancellation proposals, not manual record creation or price updates. Tool subscription IDs are checked against owned records. No AI output is accepted as proof that an external service was cancelled.

## Membership

Local testing uses `ENABLE_TEST_PLUS=true`, yielding an explicit `test_plus` entitlement. This bypasses payment gating without fabricating billing records. Production refuses that override. Real entitlements remain based on verified Razorpay events, period expiry and reconciliation. Test Plus does not enable unconfigured AI or financial-provider access.

## Production boundaries

Single Node process, TLS reverse proxy and encrypted persistent SQLite volume are the current deployment model. Docker configuration is supplied but untested here. Horizontal scaling needs a shared transactional database, centralized limits and a durable queue.

Live email-provider setup/testing, account recovery, step-up authentication, live-provider lifecycle testing, security review, operational monitoring, consent/disconnection/deletion implementation, native purchase verification, device QA and signing remain release work. Native deep-link return from provider authorization also needs implementation. Root dependency audit is clean; native build-chain audit findings remain unresolved. No regulatory certification, security certification, live financial access or production deployment is claimed.
