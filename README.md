# Subwise

A website for managing subscriptions and recurring payments, built with React, Vite, Express and SQLite.

**The website is the current product.** Native Android/iPhone source is retained in `mobile/` for later work and is not required to run, build or deploy the website.

## Run the website locally

Use Node.js 24:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. Create an account, or choose **Explore the sample workspace** to review labelled example subscriptions. Real accounts start empty.

For temporary local Plus access, set `ENABLE_TEST_PLUS=true` in `.env`. Production refuses this override; it must be false before deployment. It does not connect financial providers or create a paid membership.

## Website features

- Subscription dashboard, monthly commitments, upcoming renewals and spending breakdowns.
- Automatic monthly/yearly detection from supported financial feeds, with no manual subscription additions or statement uploads.
- Searchable catalog of 120 services with locally bundled logos and merchant aliases.
- Light/dark appearance in Settings and responsive phone, tablet and desktop layouts.
- Profile and optional monthly email preferences behind the top-right avatar.
- Provider-confirmed cancellation jobs with ownership checks, authorization, progress tracking and confirmation receipts.
- Optional AI cancellation proposals and Razorpay membership integration.
- Authenticated accounts, data export, account deletion and signed provider events.

## What currently works and what needs provider access

The website, account storage, catalog, calculations, profile preferences and automated execution/ingestion infrastructure run locally. Tests use isolated fixture accounts and adapters.

**No live bank/card/UPI or merchant-cancellation provider is connected.** An Account Aggregator arrangement does not by itself authorize arbitrary card access or merchant cancellation. A card number or UPI ID alone cannot supply transaction history. Real connections require contracted providers, approved scopes and actual supported institutions.

Automatic cancellation is available only when a merchant-authorized integration supplies a valid subscription-specific permission. A request stays pending until confirmed. No manual "I cancelled" shortcut is treated as proof. No real merchant subscription has been cancelled during development.

AI, billing and email delivery require their own server credentials. Email verification is optional for sign-in, and monthly emails require a verified address and opt-in. Plus is unlocked only for explicitly configured local testing.

Implementation and setup details:

- [Architecture](docs/ARCHITECTURE.md)
- [Financial connection contract](docs/CONNECTIONS.md)
- [Cancellation execution contract](docs/CANCELLATION.md)
- [Optional email delivery](docs/EMAIL.md)
- [Release requirements](docs/LAUNCH.md)
- [Brand asset provenance](docs/BRAND-ASSETS.md)

## Check the website

```sh
npm test
npm run build
npm run test:browser
npm audit --audit-level=high
```

GitHub Actions runs the web/backend checks and browser flows. Native builds are deferred.

## Deploy the full website

For Netlify with persistent PostgreSQL storage, follow [the Netlify deployment guide](docs/NETLIFY.md). The included API and scheduled functions retain data in PostgreSQL rather than the function filesystem. Local SQLite deployment remains supported as described below.

This project includes an authenticated Node backend. **Uploading the repository to GitHub does not deploy a running website.** GitHub Pages alone cannot run the backend, SQLite storage, provider webhooks or scheduled jobs.

Deploy the frontend and backend together on a Node-capable host with HTTPS and persistent storage:

```sh
npm ci
npm run build
NODE_ENV=production APP_ORIGIN=https://YOUR_DOMAIN ENABLE_TEST_PLUS=false npm start
```

Replace `YOUR_DOMAIN` with the real HTTPS origin. Configure `.env` or the host's secret store using `.env.example`. All bank, cancellation, AI, billing and email secrets stay on the server. Browser requests use the same origin under `/api`.

The production server serves the compiled website from `dist/`. Keep the backend running for enabled email and cancellation workers. Deploy one instance with an encrypted persistent SQLite volume; PostgreSQL is supported for shared storage, while shared rate limits and worker capacity still need deployment-specific validation before horizontal scaling. Set `TRUST_PROXY=1` only behind one trusted reverse proxy.

Docker/Compose files are included; they have not been validated by running Docker here. `node scripts/backup.js /YOUR_ENCRYPTED_BACKUP_DIRECTORY` creates a consistent SQLite backup; verify restoration on the deployment platform. Release hardening and provider validation remain listed in [LAUNCH.md](docs/LAUNCH.md).

## Repository privacy

Local `.env` files, customer databases, dependencies, generated builds, test output and signing material are excluded from version control. `.env.example` contains configuration names and placeholders, not working provider credentials.

## Native app work for later

The optional `mobile/` folder contains React Native/Expo source and Android/iPhone build configuration. It is separate from the website. See [mobile/BUILDING.md](mobile/BUILDING.md) when mobile development resumes. No installable mobile binary has been signed or distributed.
