# Direct cancellation execution

The web and native apps now authorize cancellation inside Subwise. The backend creates a durable job, sends it to a merchant-authorized adapter, and reconciles provider confirmation. There is no manual "I cancelled" completion shortcut. Public PATCH attempts to set `cancelled` or `cancellation_requested` return 409.

**No live merchant cancellation integration is currently configured.** This is the execution engine and its adapter contract, not a Netflix/Spotify/YouTube integration. A catalog logo, a financial feed, a merchant website link, and a Plus entitlement do not authorize cancellation. Real cancellation cannot be enabled merely by filling in a provider name or changing a flag.

## External prerequisite

A contracted provider/merchant must permit cancellation of the particular customer's particular subscription and return authoritative confirmation. It must bind its reference to the correct Subwise subscription and customer. A payment mandate's revocation alone must not be represented as cancellation of a merchant contract. Obtain written capabilities, supported merchants, exact scope, authentication method and production access before enabling this integration.

For context, [Google Pay's AutoPay flow](https://support.google.com/pay/india/answer/10452280?hl=en-IN) describes payer mandate management; it is not a blanket third-party subscription-cancellation API. The Subwise adapter must perform an actual permitted merchant operation.

## Server-only configuration

- `CANCELLATION_CONNECTOR_URL`: exact HTTPS origin of the authorized adapter, without a path, credentials, query or fragment.
- `CANCELLATION_CONNECTOR_SECRET`: outbound adapter bearer credential.
- `CANCELLATION_WEBHOOK_SECRET`: independent inbound HMAC credential.

These are distinct from financial-data credentials. Leave them blank until the adapter is implemented and contracted. Never place secrets in web or native bundles. No configuration was enabled in the local `.env` during this change.

## 1. Advertise a verified cancellation permission

The authorized adapter posts a signed event to `/api/webhooks/cancellations`:

```json
{
  "id": "unique-event-id",
  "type": "capability",
  "subscriptionId": "SUBWISE_SUBSCRIPTION_UUID",
  "providerRef": "opaque-provider-customer-subscription-reference",
  "version": 1,
  "scope": "subscription",
  "enabled": true,
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

The adapter must verify ownership and actual cancellation authority before issuing this capability; merchant-name matching is insufficient. Subscription references are unique. Increasing versions update or revoke permission. Older versions cannot restore revoked permission. Only `subscription` scope is accepted, not a mandate-only permission. Never advertise fixture permissions in production.

For both capability and result events, use headers `x-subwise-timestamp` (Unix seconds) and `x-subwise-signature` (lowercase hex HMAC-SHA256 of `TIMESTAMP + '.' + EXACT_RAW_BODY`) with the cancellation webhook secret. The delivery window is five minutes. Event IDs deduplicate callbacks. Re-delivery may use a fresh timestamp/signature with the same event ID.

## 2. Authorize inside Subwise

After reviewing the period-end cancellation, the signed-in user posts:

```http
POST /api/subscriptions/SUBSCRIPTION_UUID/cancel
Content-Type: application/json
```

```json
{"confirm":true,"capabilityVersion":1}
```

Ownership, paid access where enabled, affirmative confirmation, current permission, expiry and capability version are checked. The durable job stores the authorization time and exact provider reference. Repeated requests return the existing job, without a second dispatch. The operation is period-end cancellation, without a refund request. The job cannot be used to change prices, cancel another service or revoke arbitrary mandates.

## 3. Adapter execution

The worker calls:

```http
POST https://ADAPTER/cancellations
Authorization: Bearer CANCELLATION_CONNECTOR_SECRET
Idempotency-Key: subwise/cancel/JOB_UUID
Content-Type: application/json
```

```json
{
  "jobId": "JOB_UUID",
  "subscriptionId": "SUBSCRIPTION_UUID",
  "providerRef": "opaque-provider-customer-subscription-reference",
  "capabilityVersion": 1,
  "action": "cancel_subscription",
  "timing": "period_end",
  "authorizedAt": "2026-10-23T12:00:00.000Z"
}
```

The adapter validates its binding, permission and operation and uses a durable idempotency record before the actual provider mutation. It must not create an unrelated subscription or operate on a caller-supplied account. Outbound redirects are rejected. HTTP requests time out after 20 seconds.

A response that only acknowledges acceptance is:

```json
{
  "jobId": "JOB_UUID",
  "providerRef": "opaque-provider-customer-subscription-reference",
  "sequence": 1,
  "status": "submitted"
}
```

An accepted request is **not** a cancelled subscription.

## 4. Confirmation and reconciliation

The worker reconciles with `GET /cancellations/JOB_UUID` using the same bearer credential and idempotency key. Alternatively, the adapter sends a signed result event:

```json
{
  "id": "unique-result-event-id",
  "type": "result",
  "result": {
    "jobId": "JOB_UUID",
    "providerRef": "opaque-provider-customer-subscription-reference",
    "sequence": 2,
    "status": "scheduled",
    "renewalStopped": true,
    "effectiveAt": "2026-11-05T00:00:00.000Z",
    "reference": "actual-provider-cancellation-receipt"
  }
}
```

Statuses are `submitted`, `scheduled`, `cancelled` and `failed`. Successful results require `renewalStopped: true`, an effective timestamp and a confirmation reference. The exact job and bound provider reference must match. Sequence numbers increase per job. Old notifications cannot regress the result. A confirmed future effective date is scheduled; the subscription remains tracked until that date, after which the worker marks it cancelled. A completed cancellation cannot be undone by an old active financial-feed update.

The adapter must confirm the *underlying subscription* has renewal stopped. A blocked card charge, a revoked UPI mandate or a disappeared transaction is insufficient evidence.

## Failure semantics

A timeout, malformed response or connection failure after dispatch is ambiguous. The job becomes `unknown`; subsequent reconciliation uses GET rather than blindly issuing another cancellation POST. A process restart recovers stale processing leases in the same way. The adapter must retain durable status lookup records. If the command was never received, provider reconciliation/support is needed; Subwise deliberately does not assume failure or successful cancellation. A definitive provider failure is shown as failed, without marking the subscription cancelled.

Permission is checked again just before dispatch. Revoked, changed or expired permissions stop queued jobs. Tracking/account deletion is blocked while a cancellation is pending or scheduled, so the UI cannot hide an unresolved operation. Provider receipts remain in the user-scoped job record.

## Running and validation

The backend polls every 15 seconds. Clients refresh foreground data approximately every 30 seconds. SQLite must be persistent and the backend must remain running. Multi-host deployments require a shared transactional database and centralized rate limits. Monitoring and support for unresolved jobs remain deployment requirements.

Tests use an isolated database and explicit adapter fixtures, including bad signatures, account isolation, stale permission versions, replay, duplicate requests, delayed confirmation, ambiguous responses, process recovery, period-end activation and financial-feed updates. These tests do not establish a real merchant integration, live cancellation or production approval. No real subscription was cancelled during development.
