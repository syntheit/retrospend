# Retrospend

A self-hostable personal finance app with built-in bill splitting. Track expenses, manage wealth, set budgets, and split costs with friends, all in one place.

Unlike most expense splitters, Retrospend is **person-centric**: debts roll up to a single per-person balance regardless of which trip or project they came from. No groups required for a quick split, no mental math across multiple projects. You just see "you owe Sarah $35" and settle up.

[Website](https://retrospend.app) · [Matrix Chat](https://matrix.to/#/#retrospend:matrix.org) · [Contact](https://matv.io)

## Features

**Core finance**
- Expense tracking with categories, tags, and filters
- Wealth dashboard: assets, liabilities, net worth over time
- Budgets with monthly spending limits per category
- Recurring expense templates for subscriptions and bills
- Multi-currency with daily exchange rates from [syntheit/exchange-rates](https://github.com/syntheit/exchange-rates)
- Analytics and spending trends

**Shared expenses**
- Split costs with anyone, no account required for participants
- Person-centric balances: all debts with someone roll into one number
- Projects for trips, roommates, or group purchases (optional; you can split without one)
- Guest sessions via magic links, name and email gets you in within seconds
- Verification system so nobody gets quietly overcharged
- Settlement flow: record payment, payee confirms receipt, full audit trail
- Payment method matching with deep links (Venmo, PayPal, Cash App, etc.)
- Payment requests and reminders for outstanding balances
- Revision history on every shared transaction

**Import & admin**
- AI-powered bank statement importer (PDF and CSV) via Ollama or OpenRouter
- Admin panel with user management, invite controls, and system status
- Automatic database backups

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend / API | Next.js (App Router), React, Tailwind CSS, tRPC |
| Auth | Better Auth |
| Database | PostgreSQL + Prisma |
| Go sidecar | Background jobs (exchange rates, recurring expenses, backups, notifications) and AI bank import |
| File storage | Local filesystem (Docker volume) |
| Local LLM | Ollama (optional) |

## Getting Started

### Prerequisites

- Docker and Docker Compose

### 1. Get the config files

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
```

### 2. Configure environment variables

Edit `.env` and set the required variables. See the full reference below.

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** | | 32+ char secret: `openssl rand -base64 32` |
| `PUBLIC_URL` | **Yes** | | Your public URL (e.g. `https://app.yourdomain.com`) |
| `POSTGRES_USER` | **Yes** | `postgres` | Database username |
| `POSTGRES_PASSWORD` | **Yes** | | Database password |
| `POSTGRES_DB_NAME` | **Yes** | `retrospend` | Database name |
| `DATABASE_URL` | **Yes** | | Full PostgreSQL connection string |
| `WORKER_API_KEY` | **Yes** | | Shared secret between app, worker, and importer: `openssl rand -base64 32` |
| `NEXT_PUBLIC_SHOW_LANDING_PAGE` | No | `false` | Show public landing page at `/` |
| `NEXT_PUBLIC_ENABLE_LEGAL_PAGES` | No | `false` | Show `/privacy` and `/terms` |
| `UNSUBSCRIBE_SECRET` | No | | Secret for signed one-click unsubscribe links in emails |
| `SMTP_HOST` | No | | SMTP server hostname |
| `SMTP_PORT` | No | | SMTP port (e.g. `587`) |
| `SMTP_USER` | No | | SMTP username |
| `SMTP_PASSWORD` | No | | SMTP password |
| `EMAIL_FROM` | No | | Sender address (e.g. `Retrospend <noreply@example.com>`) |
| `OPENROUTER_API_KEY` | No | | Cloud LLM for bank statement import (alternative to Ollama) |
| `OPENROUTER_MODEL` | No | `qwen/qwen-2.5-7b-instruct` | OpenRouter model |
| `LLM_MODEL` | No | `qwen2.5:7b` | Ollama model |
| `BACKUP_CRON` | No | `0 3 * * *` | Backup schedule (cron syntax) |
| `BACKUP_RETENTION_DAYS` | No | `30` | Days to keep backup files |
| `TRUSTED_ORIGINS` | No | | Extra allowed CORS/auth origins (comma-separated) |

### 3. Start the services

```bash
docker compose up -d
```

The app is available on port `1997`. Migrations run automatically on startup.

**First-run notes:**

- The first user to sign up becomes admin. You can restrict further signups to invite-only in the admin panel.
- If using Ollama for AI import, pull the model after first start:
  ```bash
  docker exec local-ollama ollama pull qwen2.5:7b
  ```
- The `sidecar` and `ollama` services are optional. Remove them from `docker-compose.yml` if you don't need bank statement import.

## Production & Security

See [`docs/cloudflare-security.md`](docs/cloudflare-security.md) for Cloudflare Tunnel + WAF setup.

- Uploaded files (avatars, project images) are stored in the `uploads` Docker volume. Back it up alongside your database.
- Use strong, unique values for `AUTH_SECRET` and `WORKER_API_KEY`.

## Backups

The sidecar service handles scheduled database backups on the schedule set by `BACKUP_CRON` (default: daily at 3 AM UTC). Retention is controlled by `BACKUP_RETENTION_DAYS` (default: 30).

Backup files are written inside the sidecar container. To persist them on the host, mount a volume to `/app/backups`.

## Development

See [`docs/development.md`](docs/development.md) for running Retrospend locally from source.

## License

[GPL-3.0](LICENSE)
