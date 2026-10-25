# Netlify website deployment

The website uses Netlify static hosting for `dist`, an Express API deployed as a Netlify Function, and PostgreSQL for persistent accounts and subscription records. Local development still defaults to SQLite. No local customer database is copied to production.

## Runtime configuration

Set these values in the project's environment variables before deploying:

- `DATABASE_URL`: the private, pooled PostgreSQL connection URI (for example from Neon), including the provider's TLS parameters. Mark it secret and supply the production deploy context. Never use a `VITE_` prefix or put credentials in Git.
- `NODE_ENV=production`
- `APP_ORIGIN=https://YOUR_SITE.netlify.app`
- `ENABLE_TEST_PLUS=false`
- `REQUIRE_PAID_PLAN=true` to require Plus access. Without a configured payment provider, ordinary accounts remain locked and checkout is unavailable.
- `TRUST_PROXY=1` for the Netlify proxy.

The database variable must include the Functions scope. Free Netlify accounts can use All scopes rather than upgrading for individual scope selection. Leave financial, cancellation, AI, payment, and email credentials unset until the relevant providers are approved and tested. A PostgreSQL database does not supply financial-provider access.

The backend creates its application tables on startup. Schema initialization uses a PostgreSQL advisory transaction lock across function instances. Each request and worker invocation has its own transaction context and releases or rolls back abandoned transactions. Millisecond timestamp columns use BIGINT. Parameter values remain bound SQL parameters.

## Deploy

```sh
npm ci
npm test
npm run build
npm run test:browser
npx netlify-cli deploy --prod --context production
```

`netlify.toml` routes `/api/*` to the API function and other website paths to the SPA. API and database credentials stay on the backend. The production API sets secure, HTTP-only session cookies.

The cancellation and email scheduled functions run every five minutes in bounded batches. Both return before connecting to the database when provider configuration is absent. Cancellation jobs persist and require provider confirmation; uncertain results are reconciled instead of blindly resubmitted. Email delivery requires verified opt-in. At higher traffic volumes, size the worker capacity and move longer jobs to dedicated background execution before launch.

## Validation and recovery

The PostgreSQL suite accepts `TEST_DATABASE_URL` and creates and removes a uniquely named schema. Never point test infrastructure at the production database. GitHub Actions runs it against a dedicated PostgreSQL service. Local SQLite tests remain separate.

Verify live registration, login, account isolation, profile changes, and persistence after a fresh function invocation. Use disposable validation accounts and remove them afterward. Inspect Functions logs without printing connection strings or customer records.

For PostgreSQL backups and recovery, configure and test the database provider's backups/restore process. `scripts/backup.js` is only for the local SQLite deployment. Netlify deployment rollback does not roll back PostgreSQL data or schema. Use a separate test database for previews; do not share production credentials with untrusted preview code.

The existing memory-based API rate limits apply within one function instance. Before opening a public financial service, replace them with a shared rate-limit store, and complete the checks in `LAUNCH.md`. Free hosting/database usage remains subject to each provider's limits.

## Private Plus test entitlement

Global test access is disabled on the hosted website. The public UI does not show a free testing unlock. A separate `complimentary_plus` record grants access to the one operator-authorized test account without creating a payment-provider subscription or pretending a payment occurred. Other accounts still require an active, unexpired membership.

For initial provisioning, supply `PLUS_TEST_EMAIL` and `PLUS_TEST_PASSWORD_HASH` as production-only secrets. The password hash uses the application's salted scrypt format, never plaintext. The backend creates or updates that specifically authorized account, invalidates its previous sessions if the credential changes, and grants a private entitlement. Remove both provisioning variables after it has run; the account and entitlement persist in PostgreSQL. Revocation requires removing its `complimentary_plus` row through authorized database administration.

A complimentary member has no paid membership to cancel and cannot start duplicate checkout. Profile, privacy controls, and the service catalog remain available to ordinary accounts. Protected subscription reads and mutation endpoints enforce the membership on the server.
