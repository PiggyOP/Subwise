# Remaining work before public release

This file records actual gaps in the delivered system. Passing local tests does not establish production readiness.

A connected-only card/UPI adapter contract and signed ingestion engine are now implemented. This does not supply an approved provider integration. Manual additions and CSV imports are removed. The production Plus barrier is enabled. A private complimentary entitlement can grant an individually authorized test account access; production refuses the global testing override. Paid checkout still requires a configured payment provider.

## External access required

| Area                   | Needed before it can work live                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| India bank sync        | Eligible regulated FIU arrangement / approved partner, sandbox and production credentials, verified institution coverage and consent purposes    |
| Card transaction feeds | Issuer/data-provider contracts and supported institution feeds; manual input and CSV imports are disabled                                              |
| UPI mandate management | Approved payer PSP/UPI integration, permitted mandate operations, authorization flow and production access                                       |
| Merchant cancellation  | Per-merchant capabilities, customer authorization, tested successful cancellation evidence; universal cancellation remains unavailable           |
| AI                     | Server-side provider account/key, selected model and live tool/consent/error-flow verification                                                   |
| Web billing            | Razorpay business approval, Subscriptions enablement, INR plan, test/live keys, reachable webhook endpoint and full payment lifecycle testing    |
| Native paid release    | A store-compliant billing strategy, implemented purchase/restoration/server receipt verification where required, store review and test purchases |
| Distribution           | Your domain, TLS host with persistent encrypted storage, Expo/store accounts, unique app identifiers, signing credentials and store listings     |

## Engineering release work

- Fix or formally resolve the mobile build-chain advisories identified by `npm audit`; the automatic suggested Expo downgrade is incompatible and was not applied.
- Run iOS and Android builds on real devices, including keyboard behavior, keychain storage, session expiry, deep links, app backgrounding, accessibility, assistive tech and poor connectivity.
- Test AI with a live key, cross-tenant tool IDs, hostile merchant text, ambiguous requests, malformed tool results and provider timeouts. Verify no external account mutation is implied.
- Test Razorpay checkout end-to-end, SCA/UPI authorization where applicable, payment failure, plan renewal, cancellation, provider outage, delayed/equal-timestamp webhooks and reconciliation.
- Configure and live-test the optional email verification service; add secure account recovery, step-up authentication for sensitive actions and appropriate MFA/session controls. Current local accounts have no recovery mechanism.
- Harden checkout creation against simultaneous requests across processes and reconcile orphan provider subscriptions if persistence fails after creation.
- Add deployment monitoring, provider/webhook reconciliation schedules, alerting and recovery procedures. Test consistent backup and restoration on the actual storage platform.
- Run security, accessibility and load reviews against the deployed stack. Review financial-data handling and product disclosures with qualified local specialists. No regulatory or security certification is claimed.
- Define and implement retention, support/disputes, deletion of provider-side data, cancellation evidence retention and customer-facing terms/privacy disclosures for the actual integrations and business.
- Add server jobs and delivery-provider integration if you promise email/push renewal reminders. The delivered renewal view is in-app only.
- Use the supported PostgreSQL deployment and add centralized rate limits if scaling beyond one instance. Add a durable queue for automatic sync before claiming always-on detection.

## What not to advertise yet

Do not promise “connect any bank”, “connect your UPI ID to view everything”, “cancel any subscription”, “automatic savings”, “instant cancellation”, bank-grade certification or guaranteed fraud detection. Describe only tested capabilities and the actual coverage of contracted providers.

The visual styling, sample workspace, packaged source and compiled JavaScript do not establish any of these missing integrations or approvals.
