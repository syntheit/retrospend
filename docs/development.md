# Development setup

Running Retrospend from source. For how the pieces fit, see [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md). For the rules a change follows, see [AGENTS.md](../AGENTS.md).

## Prerequisites

- Node.js 24 and pnpm 10 (the version is pinned in `package.json`)
- Go 1.26 for the sidecar
- Docker for the dev and test databases

Or use Nix: `nix develop` provides all of the above, plus the Prisma schema engine and a Biome binary that run on NixOS. `nix develop .#android` adds the Android SDK for mobile builds.

## Web app

1. Install dependencies. This also generates the Prisma client.

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Create `.env` from the example and fill in the required values (`AUTH_SECRET`, `PUBLIC_URL`, `DATABASE_URL`, `WORKER_API_KEY`):

   ```bash
   cp .env.example .env
   ```

   For the dev database below, use `DATABASE_URL=postgresql://retrospend:retrospend_dev@localhost:5434/retrospend_dev` and `SIDECAR_URL=http://localhost:8080`.

3. Start the dev database (Postgres 16 on port 5434):

   ```bash
   pnpm db:up
   ```

4. Start the app. It applies migrations first, then serves on port 2997.

   ```bash
   pnpm dev
   ```

5. Optional: start the sidecar for exchange rates, backups and bank import.

   ```bash
   cd sidecar && go run .
   ```

## Checks and tests

| Command | What it runs |
|---|---|
| `pnpm check` | Typecheck, lint, unit tests, the UI rule ratchet and the i18n catalog check |
| `pnpm test:pg` | Real-Postgres tests. Start `docker compose -f docker-compose.test.yml up -d` and set `TEST_DATABASE_URL` (port 5436). |
| `pnpm test:e2e` | Playwright flows on a seeded database, on the e2e Postgres from `docker-compose.test.yml` (port 5437). |
| `E2E_SEALED=1 pnpm test:e2e` | The same flows with `DATA_KEYS_WRITE` on and a throwaway master key, so text is sealed on write; it also runs `e2e/flows/zz-sealing.spec.ts`. It starts its own server (no `E2E_REUSE_SERVER`). Both modes empty the e2e database before the server starts. |
| `bash e2e/visual/run.sh` | Visual regression in the pinned Playwright image |
| `pnpm --filter @retrospend/mobile test` | Mobile jest suite |
| `cd sidecar && go test ./...` | Sidecar tests |
| `pnpm build` | Production build |

## Database

- Schema: `prisma/schema.prisma`. The generated client goes to `generated/prisma` and is not committed.
- After pulling schema changes: `pnpm prisma generate`.
- Migrations are written by hand: additive, idempotent, with RLS policies and grants in the same file. See AGENTS.md §6.3.
- Apply migrations: `pnpm db:migrate`. Production applies them on container start.

### Syncing default categories

New default categories are not pushed to existing users automatically.

1. Add them to `DEFAULT_CATEGORIES` in `src/lib/constants.ts`.
2. Run the sync script in the running container:

   ```bash
   docker exec -it retrospend sh
   pnpm tsx scripts/sync-default-categories.ts
   ```

## Mobile app

The Expo app is in `apps/mobile`. Builds are local, not EAS. See [apps/mobile/README.md](../apps/mobile/README.md) for Android, iOS, F-Droid and TestFlight.

```bash
pnpm --filter @retrospend/mobile typecheck
pnpm --filter @retrospend/mobile test
```

## Troubleshooting

- **Type errors after a pull:** the Prisma client is stale. Run `pnpm prisma generate`.
- **Prisma or Biome fails to start on NixOS:** run inside `nix develop`, which points both at binaries that work there.
- **A new package version will not install:** pnpm's `minimumReleaseAge` is 7 days.
- **Sidecar cannot reach the database:** it connects to Postgres directly. Use `localhost` locally and the service name inside Docker.
- **Exchange rates are not updating:** the sidecar syncs daily at 09:05 UTC. Check its logs.
