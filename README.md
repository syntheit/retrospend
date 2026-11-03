<p align="center">
  <img src="docs/assets/banner.png" alt="Retrospend" width="100%">
</p>

[![CI](https://github.com/syntheit/retrospend/actions/workflows/ci.yml/badge.svg)](https://github.com/syntheit/retrospend/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)

Self-hosted personal finance with bill splitting built in. Track expenses, run a budget, split costs with anyone, and watch your net worth, in any currency. Runs on your own hardware, or free at [retrospend.app](https://retrospend.app).

[Website](https://retrospend.app) · [Matrix chat](https://matrix.to/#/#retrospend:matrix.org) · [Self-hosting](docs/self-hosting.md) · [Releases](https://github.com/syntheit/retrospend/releases)

## Why Retrospend

- **Person-centric balances.** Everything you and Sarah owe each other rolls up to one number, across every trip and project. No groups needed for a quick split.
- **A budget that knows about your friends.** Money you fronted for someone leaves your budget until they pay you back.
- **Real multi-currency.** Every amount keeps its original currency, and rate types are first-class (ARS official, blue, card and MEP), so the numbers match what you actually paid.
- **Yours.** Self-host it, export everything, and use the API. Android works fully without Google services.

## Features

**Money**
- Expenses and income with categories, tags, filters and search
- Envelope budgets with eight styles on one engine: Track, Limits, Flex, Every peso, Save first, 50/30/20, Weekly and Debt payoff
- Recurring expenses and income
- Wealth: accounts, assets and liabilities, net worth over time
- Daily exchange rates from [syntheit/exchange-rates](https://github.com/syntheit/exchange-rates)
- Insights and spending trends
- Every money action shows what will change before you save, and can be undone

**Shared costs**
- Split with anyone. People without an account join through a link.
- Projects for trips, households or group purchases, or split without one
- Settle up: record a payment, the other person confirms, full history
- Payment method deep links (Venmo, PayPal, Cash App and more)
- Verification, so nobody gets quietly overcharged, and revision history on every shared expense

**Apps and platform**
- Web app for desktop and phone
- Native apps for iPhone, iPad and Android, offline-first (in testing)
- Push notifications through APNs, UnifiedPush or FCM, with no personal text in the payload
- Full REST API (`/api/v1`) with OpenAPI, scoped tokens and webhooks
- Bank statement import (PDF and CSV) with a local model through Ollama or a cloud model through OpenRouter
- 7 languages
- Admin panel, invite-only sign-up, automatic backups

## Run it

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env      # set AUTH_SECRET, PUBLIC_URL, the Postgres settings and WORKER_API_KEY
docker compose up -d
```

Open port `1997` and sign up. The first account becomes the admin. Every setting, push notifications, backups and updating are in **[docs/self-hosting.md](docs/self-hosting.md)**.

## How it's built

Next.js and tRPC for the web app, a versioned REST API (oRPC, OpenAPI) for the mobile apps and other clients, PostgreSQL with row-level security, a Go sidecar for scheduled jobs and import, and an Expo app for iOS and Android. Shared TypeScript packages hold the money math, design tokens, API contract and translations.

See **[docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)** for the full picture.

## Contributing

- [docs/development.md](docs/development.md): run it from source
- [AGENTS.md](AGENTS.md): how changes are made here, for people and AI agents alike
- [CONTRIBUTING.md](CONTRIBUTING.md): issues and pull requests
- [SECURITY.md](SECURITY.md): reporting a vulnerability

## License

[GPL-3.0](LICENSE)
