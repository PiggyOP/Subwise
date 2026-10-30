# Demo bank

Accounts → Test without your phone is a Subwise-owned simulator, separate from Setu and the public sample workspace. It never contacts an Account Aggregator, sends SMS, reads a real bank account, or creates/cancels a real mandate.

The existing signed-in account and Plus entitlement are still required. Enable `DEMO_BANK_ENABLED=true` and explicitly list tester emails in `DEMO_BANK_EMAILS` on the server. These values are never frontend login credentials. A public test code selects a fixture only; it cannot sign into Subwise, unlock Plus or access another user's data.

| Test number | Test code | Dataset |
| --- | --- | --- |
| 9000000000 | 123456 | Mixed statement: Netflix, Spotify, iCloud and gym monthly debits; groceries, shopping, rides, food, transfers, salary, refunds and a duplicate delivery; annual Microsoft 365 and a cancelled magazine autopay record. |
| 9000000001 | 123456 | Everyday purchases, transfers, salary and refunds; no subscriptions or autopay records. |

The first connection creates a frozen, dated synthetic statement for that user and profile. Reconnecting reuses it without duplicating transactions or subscriptions. The statement goes through the shared ingestion and recurrence detector. Three matching monthly debits establish a candidate; a single annual charge is identified only because its separate simulated recurring record supplies the cadence. Cancelled autopay is excluded from active totals. Ordinary debits remain visible in the statement but are not manually inserted into subscriptions.

All records use their own `demo_bank` source and connection. They cannot grant merchant cancellation capability, and stay separate from `setu_sandbox`. The UI marks all resulting spending totals as synthetic. The user owns each demo run; other accounts cannot read or connect it. Deleting the user's account removes its demo data through the existing ownership cascade.

These fixtures demonstrate selected cases, not universal subscription accuracy: repeated purchases can resemble renewals, and short statement histories cannot establish annual recurrence without provider evidence. Setu's own mock-bank contents are controlled by Setu; this simulator does not alter them.
