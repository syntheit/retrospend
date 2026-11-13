# Architecture

How Retrospend is put together: the pieces, how a request moves through them, where money is computed, and why it is built this way.
For how to change it, see [AGENTS.md](../../AGENTS.md). For running it locally, see [development.md](../development.md). For running your own server, see [self-hosting.md](../self-hosting.md).

## System map

```
  Browser (web app)        iPhone, iPad, Android (Expo)      Scripts, later CLI / MCP / GTK
        │ tRPC (internal)            │ /api/v1 (REST, OpenAPI)        │ /api/v1
        ▼                            ▼                                ▼
  ┌──────────────────────── Next.js server (root package "retrospend") ─────────────────────┐
  │  src/server/api/routers/*  (tRPC, thin)      src/server/api/v1/*  (oRPC, thin)          │
  │                       └──────────────┬──────────────┘                                   │
  │                                      ▼                                                  │
  │         src/server/services/*   all business logic and every money figure               │
  │                                      │            @retrospend/domain (pure math)        │
  │                                      ▼                                                  │
  │         Prisma, user-scoped client (Postgres RLS)     event outbox → push, webhooks     │
  └──────────────────────────────────────┬───────────────────────────────────────────────────┘
                                         ▼
                                    PostgreSQL 16  ◄──── Go sidecar (cron jobs, bank import)
```

Five things run in production: the Next.js app, Postgres, the Go sidecar, an optional Ollama for the bank importer, and the mobile apps that talk to the server over `/api/v1`.

## Repository layout

The repo root is the web app and also the pnpm workspace root.

| Path | What it is |
|---|---|
| `src/` | Next.js app: routes, UI, server code |
| `prisma/` | Schema (`schema.prisma`), migrations, deferred migrations |
| `packages/domain` | `@retrospend/domain`: pure money, currency, date and split logic. No Node, DOM, React or Prisma imports (`boundary.test.ts`). |
| `packages/api-contract` | `@retrospend/api-contract`: zod schemas and the oRPC contract for `/api/v1`, and the generated `openapi.json` |
| `packages/api-client` | `@retrospend/api-client`: typed client over the contract, TanStack Query helpers, event feed |
| `packages/tokens` | `@retrospend/tokens`: design tokens (DTCG JSON) built into CSS, a TS theme and flat JSON |
| `packages/i18n` | `@retrospend/i18n`: message catalogs for 7 locales, English is the source |
| `apps/mobile` | Expo app for iOS, iPadOS and Android |
| `sidecar/` | Go service: scheduled jobs and the bank statement importer |
| `e2e/` | Playwright flows and visual regression |
| `docs/` | Design rules (`docs/ui/`), this file, setup guides |

Packages ship TypeScript source with no build step, except `tokens`, whose outputs are committed and checked by a test. Next uses `transpilePackages`; Metro reads TS directly.

## Web app (`src/`)

- `src/app/(dashboard)/`: the signed-in app (home, activity, budget, people, projects, wealth, currencies, import, settings, admin).
- `src/app/(site)/`: public pages (sign in, sign up, claim links, guest data, API docs, legal, release notes).
- `src/app/api/`: `trpc/[trpc]`, `v1/[...path]`, `auth/[...all]`, uploads and image serving, and `internal/webhooks` (called by the scheduler).
- `src/features/<area>/`: UI per product area. `src/components/ui/` holds the design-system primitives, listed in `src/components/ui/registry.ts`.
- `src/proxy.ts`: Next 16's replacement for middleware. Security headers and public-path gating.
- `src/env.js`: every environment variable, validated at startup.

## Server

### One service layer, two transports

- **tRPC** (`src/server/api/routers/`, composed in `root.ts`) serves the web app. Procedure builders live in `src/server/api/trpc.ts`:
  - `protectedProcedure`: session required, sets `ctx.db` to the user-scoped client.
  - `adminProcedure`: admin role, uses the global client.
  - `guestOrProtectedProcedure`: a user, a guest token or a viewer link. Guests get app-level checks.
- **API v1** (`src/server/api/v1/`, mounted at `src/app/api/v1/[...path]/route.ts`) is the public, versioned contract for the mobile apps and any other client. The contract lives in `packages/api-contract`.
- **Routers and v1 handlers hold no logic.** They validate, authorize and call `src/server/services/`. The UI ratchet blocks database imports and money arithmetic in transport files.

Mobile uses v1, never tRPC, because an App Store or F-Droid build lives for months against self-hosted servers on other versions and needs a versioned contract. The web app can move page by page from tRPC onto v1 without server work, because both sit on the same services and schemas.

### API v1 conventions

- REST and OpenAPI 3.1. The spec is served at `/docs/api/openapi.json` and regenerated with `pnpm exec tsx packages/api-contract/scripts/write-openapi.ts`. A test fails when the committed copy is stale.
- **Auth:** one principal from a cookie session, a bearer token (mobile), a device token (RFC 8628, approved at `/device`) or an API key (`rsk_` prefix, hashed, always expires).
- **Scopes:** `read`, `write:expenses`, `write:money`, `write:settings`, `admin`, plus session-only scopes for account security and deletion. Every route declares its scope.
- **Idempotency:** every write needs an `Idempotency-Key`. Responses are stored per user; a reused key with different input is refused.
- **Errors:** RFC 9457 problem+json with a stable `code`.
- **Rate limits:** per IP and per token, stored in Postgres.
- **Previews:** every money write has a `.../preview` twin returning what changes and what does not.
- **Sync:** cursor pagination, `updatedSince` deltas, and an events feed (`/api/v1/events`).
- **Completeness:** `src/server/api/v1/__tests__/completeness.test.ts` fails if any tRPC procedure has no v1 route and no written reason.

### Database access and row-level security

- `src/server/db-core.ts`: one `pg` pool behind Prisma's `@prisma/adapter-pg` (no query engine binary), and the one raw client every other client is built on. `src/server/db.ts` composes the app's clients with their encryption keys (E2EE D11).
- `createUserScopedDb(userId)` runs every query in a transaction that sets `app.current_user_id` and the `retrospend_app` role, so Postgres RLS policies apply. `userTransaction()` in `src/server/db-tx.ts` does the same for explicit transactions.
- Every table has an RLS policy and grants in the migration that creates it (pattern: `prisma/migrations/20260303000001_security_rls`).
- Migrations run on container start (`docker-entrypoint.sh` runs `prisma migrate deploy`). Migrations already applied in production must stay byte-identical; `src/test/migrations/applied.test.ts` checksums them.
- The generated Prisma client goes to `generated/prisma` and is not committed. Run `pnpm prisma generate` after pulling schema changes.

### Auth

better-auth (`src/server/better-auth/config.ts`) with email and password, TOTP two-factor, bearer tokens, the Expo plugin, API keys and device authorization.
- The first user becomes admin. Admins can make sign-up invite-only.
- People without an account join a split through magic links and guest sessions, and can later claim their history when they sign up.

## Money

Money is the part of the app that must never be wrong.

- **The server computes every figure.** Clients only format. Each named figure (spent, owed to you, you owe, net worth, left to spend, not planned yet, ...) has exactly one function in the figures registry (`src/server/figures/registry.ts`), which the web, v1 and the e2e number audit all read.
- **Pure math lives in `@retrospend/domain`:** minor-unit arithmetic, conversion, rounding, split computation, fiscal months and recurring dates. The rate convention is USD = 1, fiat per USD, crypto USD per coin.
- **A missing rate is an error, never 1.** It throws `MissingRateError`.
- **No floats.** Stored amounts are `Decimal` columns. The wire format is `{ minor, currency }` with integer minor units; converted amounts carry original, home, rate, rate type and rate date.
- **Exact decimals everywhere on the server.** Money math is the domain `Dec` (40 digits, half to even). Prisma's `Decimal` appears only at the database boundary and crosses by string. A number leaves Decimal only through `toFloat` or `roundedMajor`, as an object literal property value or a return value (or the amount handed to `formatCurrency`), and enters through `fromFloat`. A writer that still receives a number hands Prisma `columnText(value, scale)`. `src/test/money/arithmetic.test.ts` counts every other float and Prisma `Decimal` operation and its baseline is empty; a hit that is not money is excused by a named entry with its reason. `src/test/money/write-guard.ts` refuses a number written to a Decimal column in every real-Postgres test.
- **One rounding rule.** Every stored figure and every group balance rounds half to even, each row once, so a legacy share of 12.73333333 reads the same on the plan, the Summary tab and People.
- **Rate types are real:** ARS has official, blue, card and MEP rates. Each home currency has a default rate type the user can change. Server rate logic is in `src/server/services/rate-types.ts` and `booked-rate.ts`.
- **One formatter.** `@retrospend/domain` formats every amount on every platform. Golden vectors in `packages/domain/vectors/` run in web vitest and mobile jest.

### Money writes: preview, apply, undo

- Each money mutation is a service function in a `*.mutation.ts` file that may not import the database client directly.
- **Preview runs the real mutation** in a transaction that always rolls back, takes a figure snapshot before and after, and returns `{ changes, unchanged }` (`src/server/services/preview/`). Preview and result cannot drift because they are the same code.
- Every money mutation returns an undo token, and undo is itself a mutation.
- Only deliberate money moves (income, transfer, exchange, paying someone back) change a Wealth account, and only when the user picks one. An everyday expense never touches an account.

### Budget engine

`src/server/services/envelope/` holds the envelope budget engine. The pure core is `engine.ts`. Movements (assign, move, cover, take back) go to an append-only ledger under an advisory lock and are idempotent on client ids. One engine runs eight budget styles (Track, Limits, Flex, Every peso, Save first, 50/30/20, Weekly, Debt payoff). The budget is always in the home currency.

### Shared expenses and settling up

- Balances are person-centric: everything owed between two people rolls up to one balance, across projects.
- "Owed to you" and "You owe" are never netted in display; only net worth combines them.
- A payment is one record in the currency paid. It clears same-currency debts first, then converts.
- The receiver confirms. The app finalizes proposals left unconfirmed for 7 days (`payments/auto-finalize.ts`, hourly from `instrumentation.ts`), as the receiver, with the same writes as a confirm. A payment the receiver reopened stays pending.
- Code: `src/server/services/payments/` (the allocator is `allocate.ts`), `people/`, `shared-expenses/`, `transfers/`.

## Events, push and webhooks

- Every service mutation appends to an event outbox in the same transaction (`src/server/services/events/`). After commit, the outbox feeds three readers: the v1 events feed, signed webhooks (HMAC-SHA256, retries, SSRF guard), and push fan-out.
- **Push senders** (`src/server/services/push/senders/`): APNs for iOS, FCM for Android with Play services, and Web Push for UnifiedPush on Android without Google. Each turns on only when its settings are present.
- **A push carries ids, types and amounts, never titles, notes or names**, so a push relay cannot read anything personal.
- Email goes over SMTP (`src/server/mailer.ts`) and is skipped when SMTP is not configured.

## Go sidecar (`sidecar/`)

A single Go binary (`sidecar/main.go`) on port 8080, sharing the Postgres database through `pgx`.

| Job | Schedule |
|---|---|
| Exchange rates from [syntheit/exchange-rates](https://github.com/syntheit/exchange-rates) | daily 09:05 UTC |
| Heartbeat for the admin page | every 15 minutes |
| Database backup (`pg_dump`) with retention | `BACKUP_CRON`, default 03:00 |
| Data retention cleanup (old events, tokens, stale guests) | daily 03:00 |

- **Bank statement importer:** `POST /process` takes a PDF or CSV and streams progress as NDJSON.
  - PDFs are parsed with poppler, CSVs with a cached schema detector.
  - Rows are enriched by an LLM (Ollama or OpenRouter). It returns 503 when neither is configured.
- **How the app and the sidecar talk:**
  - The app calls the sidecar at `SIDECAR_URL` with `Authorization: Bearer $WORKER_API_KEY` (`src/server/services/integration.service.ts`).
  - The scheduler calls back into the app at `/api/internal/webhooks` with the same key.
- **Recurring expenses are posted by the app** (`src/server/services/recurring-auto-post.ts`), never by the sidecar. A Go test fails if any sidecar file inserts an expense or moves a template.
- **The sidecar copies text it is given and never composes user-facing text.**

## Mobile app (`apps/mobile`)

Expo (one SDK behind the latest, never a `.0`), React Native and expo-router. iPhone, iPad and Android ship from one codebase with native idioms on each:
- **iOS:** native controls, Liquid Glass on chrome only.
- **iPad:** a sidebar on iPadOS 26.1+.
- **Android:** modern Material 3 (floating tab bar, FAB, collapsing top bar, predictive back on Android 16+).

Minimums are iOS 16.4 and Android 8 (API 26).

- **Code layout:**
  - Route files in `app/` are thin. Screens live in `src/features/<area>/` and primitives in `src/ui/`.
  - Platform-specific files use `.ios.tsx` and `.android.tsx`, guarded by `src/ui/platformFiles.test.ts`.
  - Native modules live in `modules/` (predictive back, notifications, system surfaces, iPad sidebar, hardware keys) and config plugins in `plugins/`.
- **Server connection:** the app talks to the server only through `@retrospend/api-client` over `/api/v1`.
  - The default server is retrospend.app. "Self-hosted" on the connect screen points it anywhere.
  - The bearer token is stored in the Keychain or Keystore, keyed by server origin.
- **Offline first:**
  - Reads go through a SQLite cache (`src/data/cache.ts`) versioned by schema and build. It is cleared on sign-out.
  - Writes go through an ordered outbox (`src/data/outbox.ts`, `sync.ts`). Each entry has a client-generated id that doubles as the idempotency key and the new row's id, plus the base version it edits.
  - A conflict is parked, never dropped or retried blindly.
- **Android works fully without Google services.**
  - `google-free.json`, `test/google-free.test.ts` and `scripts/check-google-free.sh` fail the build if Play services or Firebase enter the dependency tree.
  - Without push, Android polls the events feed in a background task and posts local notifications.
- **Builds are local** (no EAS).
  - The app version is the root `package.json` version.
  - The build number is the commit count (`git rev-list --count HEAD`), shown in Settings.
  - Android release APKs go to an F-Droid repo; iOS goes to TestFlight. See `apps/mobile/README.md`.

## Design system

- Tokens are defined once in `packages/tokens/src/*.json` and generated into `src/styles/tokens.css` (web) and `@retrospend/tokens/theme` (mobile) by `pnpm ui:tokens`.
- The rules are in `docs/ui/GUIDELINE.md` and the checks in `docs/ui/CHECKLIST.md`.
- `src/test/uiRules` scans the source on every test run and compares per-file violation counts against `baseline.json`, which may only go down.

## Keeping end-to-end encryption possible

Server-side encryption of user text at rest is built behind `DATA_KEYS_WRITE` (off by default); the server holds the keys. End-to-end encryption is not built. Operators read [`docs/encryption-at-rest.md`](encryption-at-rest.md); the threat model is [`docs/security/threat-model.md`](security/threat-model.md). These rules keep the door open:

1. Every free-text field (titles, notes, names) is declared through `userText()` in `packages/api-contract/src/common/user-text.ts`, so one list names every field.
2. No server feature reads titles (merchant normalization, server AI categorization, title rules) without a client-side path. The known exception is envelope title rules.
3. Notification and email text is built in one place from ids, types and amounts.
4. The event outbox, webhooks and audit JSON carry ids, not titles.
5. Title search stays in its two services (`src/server/services/search.service.ts` and `expense-list/search.ts`), so a client-side path can replace them.
6. Plaintext length is validated in zod. No new tight `VarChar` limits on user text.
7. The sidecar copies text it is given, never composes it.

Preferred, for the same reason:
- Money math stays in pure `@retrospend/domain` functions over loaded rows.
- New entities get client-generatable ids and a version.
- User text lives in its own columns.
- API v1 treats user text as opaque.

## Deploy shape

- Two images, `synzeit/retrospend` and `synzeit/retrospend-sidecar`, plus `postgres:16-alpine`. See `docker-compose.example.yml`.
- The web image is a three-stage `node:24-alpine` build. It installs only the web app's workspace dependencies, so mobile dependencies never enter it. It runs as a non-root user on port 1997.
- Runtime configuration comes from the environment, never baked into the image. Uploads and exports live on separate volumes.

## Decision log

| Decision | Why |
|---|---|
| Root stays the web app; mobile and packages added beside it | No file moves in a 600+ file app while many branches were open. A move to `apps/web` can come later in one mechanical commit. |
| Mobile uses a versioned REST API, not tRPC | Store builds outlive server versions. Widgets and third-party clients need a stable contract anyway. |
| Full API v1 built at once | Avoids building every feature twice when the CLI, MCP and GTK clients arrive. |
| Preview is a dry run of the real write | Hand-written "what will change" logic drifted from what actually changed. |
| One figure, one function | Two screens computing the same number differently is the most common money bug. |
| Accounts change only on deliberate money moves | Without bank sync, accounts touched by every expense drift from reality. |
| Owed to you and You owe never netted | Netting made "Owed to you" rise after paying someone back. |
| Postgres RLS under a user-scoped client | A missed `where userId` in app code cannot leak another person's data. |
| Access hardening: least-privilege grants, refused raw SQL on scoped clients, `SECURITY DEFINER` hygiene | RLS stops logic bugs, not arbitrary SQL, so `retrospend_app` holds only what a scoped path uses and the scans fail a blanket grant or an unparameterized query. The limit is written down in `docs/security/threat-model.md`. |
| The app and sidecar connect as `retrospend_owner`, not the superuser (A2) | `RESET ROLE` from `retrospend_app` used to land on the superuser. It now lands on a table owner that is not a superuser and holds no database `CREATE`, until a separate login for scoped work (A3). The superuser runs only a catalog-only bootstrap and never reaches the app's environment. |
| Android without Google, Google only as an extra | De-Googled phones (GrapheneOS) are first-class. Features must not depend on Play services. |
| Integer minor units on the wire, `Decimal` in the database | Floats lose cents. ARS and crypto amounts exceed what naive formats handle. |
| Text is sealed at rest with per-user keys for personal text and one instance key for shared text; the AAD binds table, column, row id and key id (D11) | One key over everything nears the safe nonce limit, and shared text is read by people who hold no key of the author's. A ciphertext copied to another cell fails to open. |
| Opening is always on when a master key is set; sealing is behind `DATA_KEYS_WRITE`; the epoch (`fieldEncryptionSince`) is set once and never cleared | A flag-off or older-version server can still read what a flag-on one wrote. After the epoch, search and filters on text must run in the app, whatever a process's own flag says. |
| A sealing floor and start gates refuse a start that could silently make a new key or read ciphertext as text (D11 PR 9) | An older binary cannot protect itself, so the database records the highest floor and refuses a lower build, a missing master key or a lost instance key. |
| Contact lookup by a keyed hash on the instance key, with the table in the label (D11 Rev 3) | An address cannot be matched once it is sealed. One instance key keeps claim and resume working across creators, at the cost that a keyless dump shows who shares an address. |
| Recurring auto-post runs in the app; the sidecar keeps only its heartbeat | The sidecar then never holds the master key, and posting uses the same confirm code, undo and events as a manual confirm. |
| JSON copies (undo stashes, replayed responses, import rows, audit text) are sealed too | They held the same text as the columns in plaintext, so sealing the columns alone would not have changed what a dump shows. |
| No matching of category names across people (D19) | The creator's category name is under the creator's key, and the server never compares names across users. A shared expense routes by the viewer's own category or envelope rules. |
| Wording is "encrypted at rest; the server holds the keys", never "end-to-end" | The server opens every cell it needs, and no audit exists yet. |
