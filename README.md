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
| `VAPID_PRIVATE_KEY` | No | | Turns on push to Android phones through UnifiedPush (see [Push notifications](#push-notifications)) |
| `VAPID_PUBLIC_KEY` | No | derived | The matching public key, checked against the private one |
| `VAPID_SUBJECT` | No | `PUBLIC_URL` if https | `mailto:` or `https:` contact sent to push services |
| `PUSH_ENDPOINT_ALLOW_HOSTS` | No | | Hosts (names or IPs, comma-separated) that may receive push although they are on a private network, such as a LAN ntfy server. The admin setting Allow private webhook targets also allows private UnifiedPush endpoints |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | No | | Apple push (iPhone and iPad); all four APNs settings are needed |
| `APNS_KEY` or `APNS_KEY_FILE` | No | | The APNs auth key (`.p8`) as text (newlines written `\n`) or as a file path |
| `ANDROID_APP_CERT_SHA256` | No | | SHA-256 fingerprint(s), comma-separated, of the Android app's signing certificate. Served in `/.well-known/assetlinks.json` so password managers can fill in the app |
| `FCM_SERVICE_ACCOUNT` or `FCM_SERVICE_ACCOUNT_FILE` | No | | Firebase service account key (JSON or file path) for Android phones with Google Play services |
| `FCM_PROJECT_ID` | No | from the key | Firebase project, if it differs from the key's |

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

## Push notifications

Optional. Without any of these settings the server sends no push and the apps check for changes when they open. Each sender below turns on by itself once all of its settings are present; a sender with a missing or unreadable setting stays off and says which setting it did not like in the server log.

A push says what happened and carries ids and an amount. It never carries an expense title, a note or a person's name, so nothing a push service relays can be read from it. Android pushes are also encrypted for the phone (RFC 8291).

- **Android without Google (UnifiedPush).** Install a distributor such as ntfy on the phone, then create a VAPID key pair once and set `VAPID_PRIVATE_KEY` (the command is in `.env.example`). Keep the key: a new one makes every phone register again. The phone gives the server an endpoint on its distributor; the server will not connect to an endpoint on a private network (a phone on your LAN pointing at `192.168.x.x`, `localhost`, a name that resolves to one) unless you list its host in `PUSH_ENDPOINT_ALLOW_HOSTS` or an admin allows private targets for webhooks.
- **iPhone and iPad (APNs).** Create an APNs auth key in your Apple developer account and set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `APNS_KEY`. Builds signed for development use Apple's sandbox without a setting.
- **Android with Google Play services (FCM).** Set `FCM_SERVICE_ACCOUNT` to a Firebase service account key. Phones without Play services use UnifiedPush or check for changes themselves.

What is pushed: a shared expense added or changed on a split you are on, a payment recorded, confirmed, marked not received or waiting for your confirmation, a request to fix an expense, and a recurring expense or income that is due. A notification type you turned off in Settings (in-app) is not pushed either. A person gets at most 60 different pushes an hour.

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
