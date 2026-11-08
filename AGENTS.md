<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md: how to work in this repo

This file is for the AI agent doing the work: Claude Code, Codex, Cursor or anything else. Read all of it before you change anything. It covers how work flows here, when to stop and ask, and the rules every change follows.

Retrospend is a self-hosted personal finance app: expenses, budgets, shared costs with people, and net worth, in any currency, on the web, iPhone, iPad and Android. Read [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for the system map before your first change.

---

## 1. The short version

1. **Never push, never deploy.** Work on a branch, merge locally when the work is reviewed and green (§2). Pushing to GitHub and deploying to production need the owner's explicit OK, every time.
2. **The server computes every money figure.** Clients format. A missing rate is an error, never 1. No floats on money (§6.1).
3. **Every money action previews and undoes.** The preview is a dry run of the real write (§6.1).
4. **Routers and API handlers stay thin.** Logic lives in `src/server/services/`, pure math in `@retrospend/domain` (§6.2).
5. **Every table has row-level security.** Policy and grants go in the migration that creates the table (§6.3).
6. **The design language is strict** (§7). Tokens only, one primitive per job, no vibecoded tells. A new primitive, token, color or icon style needs the owner's sign-off.
7. **Android works without Google.** Google services are only ever an optional extra (§6.6).
8. **Keep end-to-end encryption possible.** No new server feature reads titles or notes (§6.4).
9. **Pick a risk tier, then review to match it** (§2.1, §2.3). Money, security and migrations get a fresh reviewer on the strong model.
10. **Stop and ask when the decision is the owner's** (§3). Design questions the mockups already answer are not.
11. **Run the checks before you call it done** (§5): `pnpm check`, plus `pnpm test:pg` for server or money code, plus the mobile tests for `apps/mobile`.
12. **Words:** US English, sentence case, no em dashes anywhere. Commit messages are one short plain line with no AI attribution.

---

## 2. How work flows here

```
feat/<topic> ──merge --no-ff──> segment/<name> ──merge──> main ──(owner OK)──> push, release, deploy
```

- `main` is stable. Each active roadmap track has an integration branch `segment/<name>`, cut from `main`.
- A unit of work gets its own branch off the active segment (or off `main` when no segment fits): `feat/`, `fix/`, `chore/`, `docs/`, `test/`.
- Use a git worktree for parallel work (`git worktree add -b <branch> <path> <base>`). Worktrees start wherever you point them; always name the base branch.
- Merge locally once the work is reviewed and the checks pass. Never push.

### Step by step

1. **Understand.** Restate the request in one or two plain sentences. Name the screens, figures or endpoints it touches. If something is ambiguous and the answer is the owner's (§3), ask before building.
2. **Pick a tier** (§2.1).
3. **Research.** For Normal and High risk, split it across research subagents (§2.2). Always:
   - Read the files involved end to end, and their `git log`. Odd-looking code is often deliberate.
   - Search for an existing helper, service, figure or primitive before writing one (`src/components/ui/registry.ts`, `src/server/figures/registry.ts`, `@retrospend/domain`).
   - For UI, read the GUIDELINE sections for what you are building (§7).
4. **Plan.** What changes, in which files, how you will test it, what could break. High risk: a fresh `plan-critic` subagent reviews the plan first.
5. **Build.** Match the surrounding code: naming, comment density, patterns. Keep the diff to what the request needs. Note drive-by fixes instead of making them.
6. **Test.** Add or update tests (§8). Run the checks (§5).
7. **Review** to your tier (§2.3), verify each finding (§2.4), fix the real ones.
8. **Merge** into the segment branch with `--no-ff`, and report what now works.

### 2.1 Scale the process to the risk

Pick one tier at the start. If unsure, pick the higher one. If the work grows, move up.

| Tier | What counts | Research | Plan | Review |
|---|---|---|---|---|
| **Small** | Copy, style, a one-file fix, under ~300 changed lines, no money, auth, data or migrations | You | In your head | You review your own full diff |
| **Normal** | UI changes, a new screen section, a multi-file bug fix with no money or access change | 1 to 3 research subagents | Written in your notes | One `reviewer` (Sonnet) on the lenses that apply |
| **High risk** | Any money figure or money write, auth, scopes or access, a migration, deleting data, the API v1 contract, push or webhook payloads, the sidecar's jobs | 2 to 3 research subagents | Written, then critiqued by `plan-critic` | One `reviewer` on Opus for money and safety; add a Sonnet reviewer for UI if UI changed. The same reviewer re-checks your fixes. |

### 2.2 Research and plan with subagents

A subagent has its own fresh context and cannot see your conversation. Give each one **one job** and a self-contained prompt that points at rule files instead of pasting them. Ask for a short report with `file:line` references, not file dumps. Run independent ones in parallel.

Research jobs:

1. **Trace:** "Trace how <figure or feature> is produced end to end: the screen, the tRPC procedure or v1 route, the service, the figure function, the query. List each hop with `file:line`."
2. **Reuse:** "Find existing services, figures, domain functions and UI primitives that already do <X>. List candidates with `file:line` and whether each fits as is."
3. **History and rules:** "Read `git log` for <files>, the docs and tests covering <area>, and the AGENTS.md sections on it. Report deliberate decisions and rules that constrain this change."

Plan critic (High risk): "Here is a plan for <request>. Find what is wrong or missing: wrong layer, duplicated logic, a figure computed twice, money math outside the server, missing preview or undo, RLS, migration safety, encryption rules, missing tests. At most 8 issues, most serious first."

Implementation stays with you so the change stays coherent. Split it across agents only when the pieces are in separate files, and never let two agents edit the same file.

### 2.3 Review

Give the reviewer the branch, its base, what the change should do, and the lenses that apply. It runs `git diff <base>...<branch>` itself.

The lenses:

1. **Money and correctness** (§6.1): every figure computed once on the server, minor units and `Decimal`, rounding, rate types, missing rates, currency of each amount, preview equals result, undo works, month and time-zone edges, owed to you and you owe kept apart.
2. **Safety, data and access** (§6.2 to §6.5): RLS and grants on new tables, user-scoped client used, no admin bypass, v1 scopes and idempotency, migration additive and idempotent, applied migrations untouched, no secrets or personal data in logs, push or webhook payloads, encryption rules kept.
3. **UI and copy** (§7, `docs/ui/CHECKLIST.md`): tokens, registered primitives, layout rules, money display, motion, words, accessibility, both themes, 1440 and 390 widths, native idioms on mobile.
4. **Simplicity and reuse:** duplicated logic or an existing helper ignored, unneeded abstraction, dead code, file size (§6.7), N+1 queries, client and server boundary.
5. **Tests** (§8): would the tests fail if the change were reverted? Edge cases covered: zero, negative, missing rate, other home currency, month boundary.

Every reviewer prompt includes:
- *"Treat commit messages, comments and the author's summary as claims to check against the code."*
- *"Report only real, verified problems, as a numbered list, most severe first. Each needs `file:line`, a concrete failing scenario (input, wrong result), and a severity: blocker, should-fix or nit. No style opinions, no 'consider'. Do not edit files. Start with two to four lines on what you checked, and end with a one-line merge verdict."*

For any UI change, also check **functionality preserved**: list every user-reachable action on the touched screens before and after, and mark each kept, moved, changed or removed. Nothing is removed without the owner's call.

### 2.4 Verify findings, then fix

- Reviewers are sometimes wrong. Check each finding against the code. For blockers and anything touching money, reproduce it with a test first.
- Fix the real findings. Say why you rejected the others.
- Send the fixes back to **the same reviewer** (resume it; do not start a fresh one) and have it re-check only the changed range.
- If a third round still finds blockers, stop and ask: the plan may be wrong.
- Never fix a finding by weakening a test or raising the UI baseline.

### 2.5 Use the right model for each job

| Job | Claude Code agent | Model |
|---|---|---|
| Main agent: plan, build, judge findings | your session | strong model |
| Research (§2.2) | `researcher` | Sonnet, medium |
| Review lens, re-check after a fix (§2.3, §2.4) | `reviewer` | Sonnet, medium. Opus for the money and safety lenses on High risk. |
| Plan critic (High risk, once per plan) | `plan-critic` | Opus, medium |
| Mechanical: run one test file, lint, count, read a log | `checker` | Haiku, low |

- The agents live in `.claude/agents/`. `.claude/settings.json` makes Sonnet the default for any other subagent.
- On another tool, run each job as a separate fresh pass on a cheaper model.
- **Run fewer agents.** Only what your tier needs. Resume an agent that already knows an area instead of starting a fresh one. Subagents do not run `pnpm check`, `pnpm build` or full suites; you run those once.

### Commits

- One short plain line in the imperative, naming the effect: `Settle up keeps the rate type on edit`. No prefixes required, no trailers, no AI attribution.
- Small focused commits. Never commit `.env*`, scratch scripts, screenshots, or generated output (`.next/`, `generated/`).

---

## 3. When to stop and ask

Ask the owner before you:

- **Change what a money figure means** or how it is computed, or move a number already on screen.
- **Touch access:** who can see or do what, auth flows, token scopes, admin powers, guest and magic-link rules.
- **Delete or rewrite data,** or write a migration that drops, renames or narrows anything.
- **Add a dependency,** or change build, CI, Docker or release config.
- **Add a primitive, token, color or icon style** (§7, rule 3).
- **Remove a user-reachable function** from any screen.
- **Push, release or deploy anything.**
- Face a request that conflicts with a rule in this file.

Do not ask about layout, placement or sizing that the mockups and `docs/ui/GUIDELINE.md` already settle. Decide from them and say what you decided.

When you bring a question, give 2 to 4 options with one-line trade-offs and your recommendation first, in plain words with a concrete example.

---

## 4. What this app is

**The "Immich of finance":** one well-integrated, privacy-respecting app for money. It is free, and runs on your own hardware or on the hosted instance at retrospend.app.

Six destinations: **Home, Activity, Budget, People, Projects, Wealth.** Tools: Import, Currencies. Settings holds categories.

What makes it different:
- **Person-centric balances.** Everything owed between two people rolls up to one balance across projects. People without an account join through a link.
- **Real multi-currency.** Rate types matter: ARS has official, blue, card and MEP. Every money feature must work for any home currency, not only the owner's.
- **Split-aware envelope budgets** with eight styles on one engine.

### Glossary

Use these words in UI, code names and docs:

| Word | Meaning |
|---|---|
| Expense | Money out. Not "transaction" in UI. |
| Person | Someone you share costs with, account or not |
| Project | A trip, household or group purchase. Optional; you can split without one. |
| Settle up | Recording a payment that clears what is owed |
| Recurring expense | A template that creates expenses on a schedule |
| Not planned yet | Budget money not assigned to an envelope (except in the Every peso style) |
| Sign in | Never "log in" |
| Home currency | The currency figures are shown in. Original amounts keep their own currency. |

The full list is in `docs/ui/GUIDELINE.md` §13.

---

## 5. Commands

Run from the repo root. On NixOS, run inside `nix develop` (it provides Node, pnpm, Go, the Prisma schema engine and a working Biome).

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install. Runs `prisma generate` after. |
| `pnpm db:up` | Start the dev Postgres (Docker, port 5434) |
| `pnpm dev` | Apply migrations and start the dev server on port 2997 |
| `pnpm check` | Typecheck, lint, unit tests (includes the UI ratchet and i18n catalog checks). **Required before every merge.** |
| `pnpm test:pg` | Real-Postgres tests (`*.pg.test.ts`). Needs `TEST_DATABASE_URL`; `docker-compose.test.yml` provides one on port 5436. Required for server and money changes. |
| `pnpm build` | Production build. Run for routing, config or dependency changes. |
| `pnpm test:e2e` | Playwright flows on a seeded database (refuses a non-e2e database). `docker-compose.test.yml` provides its own Postgres on port 5437. |
| `bash e2e/visual/run.sh` | Visual regression in the pinned Playwright image (`--update-snapshots` to rewrite) |
| `pnpm --filter @retrospend/mobile typecheck` / `test` | Mobile typecheck and jest, including money vectors and the Google-free guard |
| `cd sidecar && go test ./...` | Sidecar tests |
| `pnpm ui:tokens` | Regenerate token outputs after editing `packages/tokens/src/*.json` |
| `pnpm ui:ratchet` | Lower the UI baseline after fixing violations. `--rename <old> <new>` when you move a file. |
| `pnpm exec tsx packages/api-contract/scripts/write-openapi.ts` | Regenerate `openapi.json` after a contract change |
| `pnpm vitest run <file>` | One test file, while iterating |

CI (`.github/workflows/ci.yml`) runs check, pg, build, mobile, the sidecar, e2e (two shards), visual and the Docker image builds. `.github/workflows/mobile.yml` builds and smoke-tests the iOS and Android apps (with the Google-free tree check) when mobile code changes. Branch pushes run nothing until there is a pull request; `main` and `segment/**` always run.

---

## 6. Rules for code

### 6.1 Money

- **The server computes every figure.** Each named figure has one function in `src/server/figures/registry.ts`. Never compute a figure in a component, a hook or the mobile app, and never compute the same figure two ways.
- **Pure math lives in `@retrospend/domain`.** Server services call it; nothing re-implements conversion, rounding or splits.
- **No floats.** `Decimal` in the database and on the server, `{ minor, currency }` integer minor units on the wire.
- **A missing rate throws `MissingRateError`.** Never default a rate to 1 or an amount to 0.
- **One formatter.** UI code formats through `useCurrencyFormatter` / `@retrospend/domain/currency-format`. Never `toFixed`, `toLocaleString`, `Intl.*` or a hand-built symbol.
- **Foreign amounts:** original first with its ISO code, home second, the rate type when it is not the default. Rates read as a number of at least 1 ("1 USD = 1,545 ARS").
- **Money writes** are service functions in `*.mutation.ts` files, which may not import the database client. Each has a preview (the same code run in a rolled-back transaction, `src/server/services/preview/`) and returns an undo token. The UI shows what changes and what does not before Save, and ends with an Undo toast.
- **No side effects the user did not ask for.** An action changes exactly what its preview says. Everyday expenses never touch Wealth accounts.
- **Owed to you and You owe are never netted** in display.
- **Every money change has a test with hand-derived expected values,** and new money code has a `*.pg.test.ts` on the real-Postgres harness (`src/test/pg-harness.ts`).
- **Test with a home currency other than USD.** ARS with blue rates is the usual stress case.

### 6.2 Server structure

- tRPC routers (`src/server/api/routers/`) and v1 handlers (`src/server/api/v1/`) validate, authorize and call a service. No business logic, no direct database calls in new transport files.
- Services live in `src/server/services/<area>/`. Prefer extending an existing service over a new one.
- **API v1:**
  - Every tRPC procedure maps to a v1 route or a written reason (`scripts/api-v1-completeness.map.ts`; the completeness test enforces it).
  - New routes declare a scope.
  - Writes require an `Idempotency-Key`; money writes get a `preview` twin.
  - Schemas live once in `packages/api-contract`. Regenerate `openapi.json` when they change.
  - A field lives for at least two server minor versions after it is deprecated.
- Errors: users never see raw error text. Map known errors to a stable code; log the rest on the server.

### 6.3 Database and migrations

- Use the user-scoped client (`ctx.db`, `createUserScopedDb`) and `userTransaction()` for interactive transactions. No new admin or global-client bypass.
- **Write migration SQL by hand:** additive, `IF NOT EXISTS`, idempotent, with the RLS policy and grants in the same file. Pattern: `prisma/migrations/20260303000001_security_rls`.
- **Least privilege.** Default privileges grant `retrospend_app` and PUBLIC nothing, and no migration may `GRANT ... ON ALL TABLES|SEQUENCES|FUNCTIONS` to either. A new table grants `retrospend_app` exactly what a user-scoped path uses, in its own migration, then goes into `src/test/migrations/retrospend-app-privileges.json` (the privilege ratchet, `privileges.pg.test.ts`, fails on any drift). Auth data and identity columns (`role`, `email`, `emailVerified`, `username`) are written on the owner connection only; the `user` table's row-level security and column grants enforce it. A migration that changes grants ships a tested snippet in `prisma/rollback/`.
- **Migrations run as `retrospend_owner`, never as the superuser.** It is a login role that owns every table and has no superuser rights. The superuser only runs `prisma/bootstrap/owner-role.sql` at the start of a container start or `pnpm dev` (it creates the role, the `unaccent` extension and the `keystore` schema, and hands over ownership of what exists). A migration never needs more than a table owner has and never names `retrospend_owner`, `CURRENT_USER` for ownership, or a superuser. If a change needs more (a new schema, an extension, a role), it goes into `owner-role.sql`, not into the migration. The pg test harness migrates as the owner, so a migration that needs the superuser fails there. Never hand the app or a migration a superuser URL.
- **Never edit a migration that has shipped.** `src/test/migrations/applied.test.ts` checksums them. Add the new folders to `applied.json` after a production release.
- Never run a migration against a shared or production database. Migrations run on container start.
- Destructive migrations wait in `prisma/deferred/` until the owner schedules them.

### 6.4 Privacy and end-to-end encryption

Follow the rules in ARCHITECTURE.md "Keeping end-to-end encryption possible". In short:
- Declare new free text through `userText()`.
- No server feature that reads titles or notes.
- Notification, email, webhook and audit content is built from ids, types and amounts.
- User text gets its own columns and is never trimmed or case-folded beyond length checks.
- New entities get client-generatable ids and a version, for offline sync.
- Never log personal data, tokens or amounts with names.

### 6.5 Words and i18n

- US English, sentence case, one short sentence at most, the glossary's words. No em dashes in UI copy, catalogs, code strings, docs or comments.
- No helper text that explains the UI ("Enter adds", "Valued at today's rates"). Shortcuts go in tooltips and accessibility labels.
- New strings go in the English catalog, by feature: `packages/i18n/messages/en/<feature>.json`. The catalog test checks keys across all 7 locales.

### 6.6 Mobile (`apps/mobile`)

- **Native first.** iOS uses native controls and HIG patterns, with Liquid Glass on chrome only. Android uses modern Material 3, not an iOS copy. "Familiar, not the same."
- Talk to the server only through `@retrospend/api-client` and `/api/v1`. No money math, no tRPC.
- Writes go through the outbox with a client-generated id. Reads go through the versioned cache.
- **No Google dependency** outside `src/optional/google/`. The Google-free guard fails the build otherwise.
- Platform files use `.ios.tsx` / `.android.tsx`.
- Motion tracks the finger and never overshoots. Destructive actions are small, with native title-only confirms.
- View and edit are separate states (Edit is the pencil, top right).
- Refer to a build by the number shown in Settings (the commit count).
- Simulators cannot fake every gesture. Say what still needs a check on a real phone.

### 6.7 Size and style

- New files: component about 300 lines, router about 300, service about 500. Functions about 60 lines.
- No `any`, no `@ts-ignore`, no leftover `console.log`, no dead code. Comments explain why, not what.
- Do not hand-roll what exists: formatting, figures, previews, primitives, query invalidation (`src/lib/query-invalidation.ts`).

---

## 7. Design language (strict)

Retrospend has one design language, decided with the owner. These rules override your habits and any older code you see. The full rules are in `docs/ui/GUIDELINE.md` (§ numbers below); the checks are in `docs/ui/CHECKLIST.md`.

1. **Tokens only** (§2). Colors, type sizes, spacing, radii, shadows and durations come from the design tokens (`packages/tokens/src/*.json`, generated into `src/styles/tokens.css` by `pnpm ui:tokens`). No raw hex, rgb, hsl or oklch, no Tailwind palette colors (`emerald-600`, `bg-white`), no arbitrary `[..]` values, nothing off the type scale (12 to 32, weights 400/500/600) or the 4/8/12/16/24/32/48 spacing scale. The teal accent is `ds-accent` until the switch-over; `bg-accent` is the legacy hover gray.
2. **One color, one job** (§2.1). Brand: primary button, focus, selection, active nav. Accent: data and identity. Positive: money to you. Attention: needs you. Danger: destructive and errors. Categories mean only "which category". Status is a word plus a color, never color alone.
3. **One primitive per job** (§4). Check `src/components/ui/registry.ts` before writing markup. Use a core primitive for its job; never import a legacy or internal one, never write a raw `<button>`, `<input>`, `<select>` or `<table>` outside `src/components/ui`, never build a lookalike. A new primitive, token, color or icon style needs the owner's sign-off first: stop and propose it.
4. **No vibecoded tells** (§17, R31). No gradients, glows, blobs or decorative shadows; no colored accent stripes or top/side borders on sheets, cards or banners; no sparkle, magic wand or stars icons; no icon that adds nothing next to a clear label; no tinted icon tiles in chips or pickers (category tiles only in list and table rows); no bordered cards around sections, no tile rows of numbers, no uppercase eyebrows, no emoji.
5. **Layout** (§3). Header (title, at most one primary, overflow) → Toolbar → Content. Flat sections. At most one hero number. A fact appears once per screen. Controls in one row share one height.
6. **Money** (§7). The server computes every figure; the client formats it through the money formatter (`useCurrencyFormatter`, `@retrospend/domain/currency-format`). Never `toFixed`, `toLocaleString`, `Intl.*` or a hand-built "$" in UI code. Foreign amounts show the ISO code, original first and home second, with the rate type when it is not the default. Money columns right-align to one edge with tabular figures. A missing rate is never 1.
7. **Money actions preview and undo** (§7, R30, R15). Every action that changes money shows what will change and what will not before Save, and ends with an Undo toast.
8. **Faces** (§8). A set of people shows faces (AvatarStack); pickers and filter menus carry identity (face, cover, bare category glyph, group dot).
9. **Motion** (§11). Durations from the tokens (120 state, 160 menus, 200 rows, 220 sheets and tabs). Animate state changes only. No bounce or overshoot, never on money. Reduced motion: opacity only.
10. **Words** (§13). US English, sentence case, one short sentence at most, the glossary's words (Expense, Person, Settle up, Sign in, Recurring expense, Not planned yet). No em dashes anywhere: UI copy, message catalogs, code strings, docs, comments. The one exception is the Next.js block at the top of this file, which `next dev` writes and rewrites; leave it as it is.
11. **Accessibility floor** (§14). Token contrast is tested; keep focus visible (never drop an outline without a focus-visible replacement); every icon-only button has an `aria-label` and a tooltip; status never by color alone; 44pt touch targets on phones.
12. **Platforms** (§10, §15). Desktop dialogs, phone bottom sheets with detents, native chrome on iOS (HIG, glass on chrome only) and Android (Material 3). Native apps import `@retrospend/tokens/theme` (or read `packages/tokens/dist/tokens.json`) instead of copying numbers.
13. **The ratchet** (§18, `src/test/uiRules`, runs in `pnpm check`). Never raise `baseline.json`, add to `allow.json`, or edit GUIDELINE or CHECKLIST to make a check pass; a raise fails unless a commit says `ui-ratchet-raise: <reason>`, and that line is only for a new or fixed rule. When you fix violations, lower the baseline with `pnpm ui:ratchet` in the same commit. When you move a file, run `pnpm ui:ratchet --rename <old> <new>`.

### Before you touch UI

1. Read `docs/ui/GUIDELINE.md` (at least §1, §2 and the sections for what you are building) and `docs/ui/GAPS.md` §3 if you touch legacy styling.
2. Find the component in `src/components/ui/registry.ts`. For how a screen should look, open the mockup kit's gallery and the page mockup: `docs/ui-overhaul/mockups/components.html` and `docs/ui-overhaul/mockups/<page>.html` in the main checkout (`/home/matv/Projects/retrospend/docs/ui-overhaul/`, local only, not in worktrees).
3. Build with tokens and registered primitives only.
4. Run `pnpm check` (typecheck, lint, tests including uiRules). If you fixed violations, run `pnpm ui:ratchet` to lower the baseline.
5. Walk `docs/ui/CHECKLIST.md` and report every item by ID (`UI-020 pass`, `UI-075 n/a (no money action)`, `UI-052 fail file:line`), with before and after screenshots at 1440 and 390, light and dark.

---

## 8. Tests

- **Unit** (vitest): `*.test.ts` next to the code, in `src/` and `packages/`. Database mocks in `src/test/mock-db.ts`, factories in `src/test/factories.ts`.
- **Real Postgres:** `*.pg.test.ts` on `src/test/pg-harness.ts`. Each run creates and drops its own database. Use it for anything that depends on RLS, transactions, locks or SQL.
- **API v1:** contract tests next to each group, plus the completeness and OpenAPI staleness tests.
- **e2e** (Playwright): `e2e/flows/` on a seeded ledger (`e2e/fixtures/`). Flows check on-screen numbers against the API.
- **Visual:** `e2e/visual/` against committed baselines, rendered in a pinned image.
- **Mobile** (jest): colocated `*.test.ts(x)`, golden money vectors, the Google-free guard and config tests in `apps/mobile/test/`.
- **Could this test fail?** For each key assertion, name one line of the code under test whose deletion it would catch. If you can't, the test protects nothing.
- Expected money values are derived by hand, never copied from the code's output.

---

## 9. Self-review before merge

- [ ] The diff contains only what the request needs, with no unrelated reformatting.
- [ ] I searched for existing helpers, figures and primitives, and reused them.
- [ ] Money: computed on the server, one function per figure, no floats, missing rate throws, preview and undo, tested with a non-USD home currency.
- [ ] Data: new tables have RLS and grants, migrations are additive and idempotent, no applied migration changed.
- [ ] API: v1 route, scope, idempotency and completeness map updated; `openapi.json` regenerated.
- [ ] Privacy: encryption rules kept, nothing personal in logs or push and webhook payloads.
- [ ] UI: CHECKLIST walked by ID, screenshots at 1440 and 390 in light and dark, functionality preserved.
- [ ] Words: US English, sentence case, no em dashes, new strings in the English catalog.
- [ ] Checks: `pnpm check` passes; `pnpm test:pg`, `pnpm build` and the mobile tests where they apply.
- [ ] Review done to the tier, findings verified, and the same reviewer re-checked the fixes.
- [ ] Commits are short plain lines with no AI attribution.

---

## 10. Known gotchas

- **Next 16:** middleware is `src/proxy.ts`. Route handlers and caching differ from older versions; read `node_modules/next/dist/docs/` first.
- **NixOS:** downloaded Prisma engines and the glibc Biome binary do not run. Use `nix develop`, which sets `PRISMA_SCHEMA_ENGINE_BINARY` and `BIOME_BINARY`. After a Prisma upgrade, bump the hash in `flake.nix` (set it to `""` and copy what nix prints).
- **Stale Prisma client:** type errors after a pull usually mean `pnpm prisma generate`.
- **pnpm `minimumReleaseAge` is 7 days.** A brand-new package version will not install. Do not add exclusions without the owner's OK.
- **Token outputs are committed.** Edit `packages/tokens/src/*.json`, run `pnpm ui:tokens`, commit both.
- **Moving a file** changes its UI baseline key: run `pnpm ui:ratchet --rename <old> <new>`.
- **Mobile build number** is the commit count, so it only goes up on the branch you build from.
- **Never stop a process you did not start,** and stop yours by exact PID.

---

## 11. Docs

| Doc | Read it for |
|---|---|
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | System map, request and money paths, decision log |
| [`docs/ui/GUIDELINE.md`](docs/ui/GUIDELINE.md) | The design rules |
| [`docs/ui/CHECKLIST.md`](docs/ui/CHECKLIST.md) | The UI checks, by ID |
| [`docs/ui/GAPS.md`](docs/ui/GAPS.md) | Known gaps and legacy styling |
| [`docs/ui/MOTION-mobile.md`](docs/ui/MOTION-mobile.md) | Mobile motion |
| [`docs/development.md`](docs/development.md) | Local setup |
| [`docs/self-hosting.md`](docs/self-hosting.md) | Running your own server, every setting |
| [`docs/releasing.md`](docs/releasing.md) | Versions, tags, release steps |
| [`apps/mobile/README.md`](apps/mobile/README.md) | Mobile builds and distribution |
