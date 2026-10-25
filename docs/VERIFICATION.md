# Website verification record

Checked locally on 25 October 2026 before GitHub publication.

| Check | Outcome |
| --- | --- |
| Web production build | Passed |
| Backend, detection, billing, email and cancellation tests | 29 passed |
| Automated browser flows | 6 passed |
| Root website/backend dependency audit | 0 reported vulnerabilities |
| Production deployment | Not performed |
| Actual bank/card/UPI connection | Not configured; no approved provider supplied |
| Live merchant cancellation | Not configured; no merchant-authorized adapter supplied |
| Live AI/payment/email delivery | Not verified; credentials/provider setup outstanding |

Browser tests cover sample labels, the 120-service logo catalog and filters, connected-only behavior, profile persistence, phone layouts, temporary Plus access and the authorized cancellation/confirmation UI. Backend tests cover ownership, paid access, signatures, replay protection, recurring inference, UPI revocation, email scheduling and cancellation recovery. Provider events and external operations in tests are isolated fixtures, not live customer transactions.

The repository is website-focused. Prior native source and configuration remain in `mobile/` for future development, outside the website build and CI job. Native project generation and JavaScript exports were previously checked; no signed installable mobile binary or real-device release is claimed. Native dependency advisories still require review before resuming a mobile release.

Passing these checks does not establish a production-ready financial service. The remaining integrations, deployment controls and release work are recorded in `LAUNCH.md`.
