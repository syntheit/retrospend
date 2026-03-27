# Development Setup

## Architecture Overview

Retrospend has two services:

- **Next.js app** (port 3000): frontend, API (tRPC), and auth. The main codebase.
- **Sidecar** (Go, port 8080): background jobs (exchange rate sync, recurring expenses, backups, data retention cleanup) + bank statement import pipeline (PDF/CSV parsing via LLM).

Both share a PostgreSQL database. Uploaded files (avatars, project images) are stored on the local filesystem.

```
src/
├── app/                    # Next.js pages and API routes
├── components/             # React components
├── hooks/                  # Custom React hooks
├── lib/                    # Shared utilities
├── server/
│   ├── api/routers/        # tRPC routers (thin controllers)
│   └── services/           # Business logic
└── trpc/                   # tRPC client setup

sidecar/                    # Go sidecar (worker + importer)
prisma/                     # Schema and migrations
```

Key patterns:
- tRPC routers are thin; business logic lives in `src/server/services/`
- `protectedProcedure` for authenticated endpoints, `publicProcedure` for public ones
- Currency amounts stored as `Decimal(19,8)`, all conversions go through `useCurrencyConversion()` hook (client) or `convertCurrency()` (server)
- Server time is authoritative for date comparisons (never `new Date()` on client for month logic)

## Prerequisites

- Node.js 20+ and pnpm
- Go 1.22+
- Docker (for PostgreSQL), or Nix (`flake.nix` included; run `nix develop` to get everything)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`. For local development, set:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/retrospend
SIDECAR_URL=http://localhost:8080
```

Required variables: `AUTH_SECRET`, `PUBLIC_URL`, `POSTGRES_PASSWORD`, `WORKER_API_KEY`.

### 3. Start backing services

```bash
docker compose up -d postgres
```

### 4. Set up the database

```bash
pnpm db:migrate
```

To skip generating migration files (faster iteration):

```bash
pnpm db:push
```

### 5. Run the application

Start each service in a separate terminal:

```bash
# Next.js app (port 3000)
pnpm dev

# Sidecar service (port 8080)
cd sidecar && go run .
```

App runs at `http://localhost:3000`.

## Testing

### Unit tests (vitest)

```bash
pnpm test
```

### Go tests

```bash
cd sidecar && go test ./...
```

### End-to-end tests (Playwright)

```bash
pnpm test:e2e
```

## Database

### Migrations

New migration:

```bash
npx prisma migrate dev --name <description>
```

Deploy migrations:

```bash
npx prisma migrate deploy
```

Regenerate Prisma client after schema changes:

```bash
pnpm db:generate
```

### Syncing Default Categories

New default categories added to the app are not automatically pushed to existing users. To sync them:

1. Add the categories to `src/lib/constants.ts` in the `DEFAULT_CATEGORIES` array.

2. Run the sync script in the running container:

   ```bash
   docker exec -it retrospend sh
   pnpm ts-node scripts/sync-default-categories.ts
   ```

## Building

```bash
pnpm build
```

Skip environment validation:

```bash
SKIP_ENV_VALIDATION=1 npx next build
```

## Troubleshooting

**Prisma client out of sync after schema changes:**
```bash
pnpm db:generate
```

**Sidecar can't connect to the database:**
The sidecar connects directly to PostgreSQL. Make sure `DATABASE_URL` is accessible from where the service is running (use `localhost` for local dev, `postgres` for Docker).

**Exchange rates not updating:**
The sidecar syncs rates daily at 09:05 UTC. Check sidecar logs: `docker logs retrospend-sidecar --tail 50`.
