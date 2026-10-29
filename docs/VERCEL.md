# Vercel deployment

The website and Express API run on Vercel at `https://piggyop-subwise.vercel.app`. The existing Neon PostgreSQL database remains the source of accounts, passwords, memberships, sessions, profiles, subscriptions, and provider connections. No database export, reset, or replacement is needed.

## Runtime

`vercel.json` builds the Vite frontend and routes `/api/*` to `api/index.js`. The adapter passes the original Node request stream to Express, preserving signed webhook bytes. The API is pinned to Mumbai, India (`bom1`) and uses the existing isolated PostgreSQL transaction contexts. Setu support confirmed that non-Indian source IPs receive HTTP 403, so do not deploy the API in a foreign region or configure foreign failover regions. The CDN region shown for a browser request is not evidence of the function's outbound location; verify a deployed Setu call after a region change. Long-running process timers are disabled.

Production-only server variables:

- Existing `DATABASE_URL`, provider credentials, membership flags and webhook secrets, copied securely from Netlify.
- `APP_ORIGIN=https://piggyop-subwise.vercel.app` for strict origin checks and provider return URLs.
- `NODE_ENV=production`, `SUBWISE_SERVERLESS=1`, `TRUST_PROXY=1`.
- **`NODEJS_HELPERS=0`**: disables Vercel request helpers so Express controls body parsing and signed webhook bytes stay intact.
- `SUBWISE_WORKER_SECRET`: at least 32 random characters, shared only with the existing scheduler.

Keep credentials out of `VITE_` variables, source control, deployment logs and preview builds. Ordinary previews must use a separate database and separate provider test configuration. Never provision the test Plus password again; its entitlement already exists in Neon.

## Background jobs

Vercel Hobby only supports daily cron jobs. To preserve the existing five-minute schedules without introducing a paid plan, Netlify's three scheduled functions are retained as a temporary scheduler. They send authenticated POST requests to Vercel; provider calls and database work execute on Vercel. Netlify remains an infrastructure dependency for these schedules.

Set `SUBWISE_WORKER_ORIGIN=https://piggyop-subwise.vercel.app` and the same `SUBWISE_WORKER_SECRET` in Netlify production. The scheduler forwards only to HTTPS `.vercel.app` origins, refuses redirects and reports failures without falling back to duplicate local processing. Vercel verifies the bearer secret in constant time before executing a known job. No secret is included in a URL. Existing worker leases, batch limits, provider capability checks, email opt-in and idempotency remain intact.

To remove Netlify entirely, migrate these triggers to a suitable scheduler or a Vercel plan supporting the required frequency, verify delivery, then disable the old triggers. Vercel Hobby is for personal non-commercial use; commercial launch requires an appropriate plan. The `vercel.app` subdomain does not require buying a domain.

## Cutover and rollback

Verify health, login with the existing account, Plus access, profile reads, catalog assets, private API rejection, signed webhook behavior and Setu connectivity on Vercel before redirecting the old website. A new hostname requires users to sign in again; session cookies are not copied between unrelated domains.

Keep the Netlify API paths available for existing external callbacks until provider settings have been migrated. Browser pages on the old Netlify URL can redirect to Vercel. External Setu Bridge callbacks still require the correct provider dashboard configuration; the Beeceptor sandbox callback is not automatically updated by changing web hosts.

The initial Singapore deployment returned Setu's hosting-server rejection (HTTP 502 from Subwise wrapping the provider's HTTP 403). On 29 October 2026, Setu support confirmed in ticket 142457 that requests must originate from Indian IPs. This requires the Mumbai function region, rather than a host change alone. Sandbox consent and data retrieval must still be verified separately; a successful token request does not imply that a bank is connected.

The Mumbai production deployment and project default are both `bom1`. The post-deployment check returned a sandbox authorization URL on `fiu-uat.setu.co`, with a pending consent and no recorded provider error; the user confirmed that the flow opened successfully. Bank linking and financial-data import remain separate steps.

Rollback means removing the website redirect and unsetting `SUBWISE_WORKER_ORIGIN` in Netlify. This restores its original API/scheduler execution against the same Neon database without rolling back user data. Avoid running two independent schedulers for the same queue.
