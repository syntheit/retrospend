# Retrospend Worker

Background service for scheduled tasks in Retrospend.

## Overview

The worker service handles:

- **Exchange rate synchronization** - Daily at 09:05 UTC from GitHub source
- **Recurring expense processing** - Every 15 minutes for due subscriptions/bills

## Architecture

- **Language**: Go 1.22+
- **Database**: Direct PostgreSQL access (shared with Next.js app)
- **Scheduler**: `robfig/cron/v3`
- **Deployment**: Docker container alongside main app

## Development

### Prerequisites

- Go 1.22+ (included in Nix flake)
- PostgreSQL connection

### Local Run

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/retrospend"
cd worker
go run .
```

### Build

```bash
cd worker
go build -o worker .
```

## Docker

The worker runs as a separate service in docker-compose:

```bash
docker compose up --build worker
```

View logs:

```bash
docker logs retrospend-worker -f
```

## Environment Variables

- `DATABASE_URL` (required) - PostgreSQL connection string
- `LOG_LEVEL` (optional) - Logging level, default: "info"

## Tasks

### Exchange Rate Sync

- **Schedule**: `5 9 * * *` (09:05 UTC daily)
- **Source**: https://github.com/syntheit/exchange-rates
- **Logic**: Fetch, validate, update/insert/delete rates in transaction

### Recurring Expenses

- **Schedule**: `*/15 * * * *` (every 15 minutes)
- **Logic**: Find due templates, create expenses, update next due dates
- **Filters**: Only processes `is_active = true` and `auto_pay = true`

## Database Access

The worker has direct read/write access to:

- `exchange_rate` table
- `recurring_template` table
- `expense` table

Uses connection pooling with health checks.

## Monitoring

Check worker health:

```bash
docker ps | grep retrospend-worker
```

View recent logs:

```bash
docker logs retrospend-worker --tail 100
```

## Future Extensions

Planned tasks:

- Daily wealth snapshots
- Shared expense notifications
- Database maintenance jobs
