# Roadmap Research Notes (2026-07-14)

Condensed findings from the multi-agent research run backing `docs/roadmap.html`.
Full mobile/API detail lives in `docs/platform-expansion-2026.md`.

## Diagnosed issues (quick fixes, target 0.4.4)

| Issue | Cause | Fix |
|---|---|---|
| Logged out every ~2 weeks | `expiresIn: 7d`, `updateAge: 1d` — hard cap after 7 idle days (`src/server/better-auth/config.ts:43`) | Raise expiresIn to 30–60d |
| Transparent sticky table header | `bg-muted/50` on thead (`src/components/ui/table.tsx:26`) | Opaque bg |
| Person view hides "bought for you" | `people.service.ts` requires BOTH parties in `splitParticipants`; payer without a share is invisible | Widen filter to payer-OR-participant |
| Project types confusion | Already removed (0.4.4 branch, `remove_project_type` migration) | Done ✅ |
| Receipts | `SharedTransaction.receiptUrl` exists in schema, no UI; `Expense` lacks field; storage/serving infra exists | Build UI in 0.7 |

## Strategy decisions (researched & settled)

- **Mobile**: Expo + RN (SDK 57, New Arch is now mandatory & settled). Use `@trpc/tanstack-react-query` (not classic), plain `httpBatchLink` (stream link flaky on RN), Hermes polyfills needed (URL, crypto.getRandomValues, TextDecoder). tRPC types carry over intact — the key advantage over Flutter/KMP. Server-URL onboarding: Bitwarden pattern (base URL + probe + editable later). Immich's concrete flow: single screen, URL field with auto-`https://`, 5s ping to `/api` before revealing the credential fields, `/.well-known/immich`-style discovery endpoint for proxies, pre-login settings for self-signed certs — copy this. App Store: demo mode with sample data satisfies review.
- **Public API**: hand-written REST `/api/v1` route handlers over the *services layer* (NOT tRPC annotation — trpc-openapi ecosystem unmaintained for v11). OpenAPI spec via zod-to-openapi from existing schemas → generated SDKs (Immich pattern). Start ~20 endpoints.
- **API auth**: better-auth `apiKey` plugin (v1.5+: separate `@better-auth/api-key` package) — scoped, rate-limited, expiring PATs. Bearer plugin for mobile. OAuth provider plugin exists if ever needed. Auth.js is dead (joined better-auth 2025-09).
- **Receipt OCR (phased)**: P0 store photos (convert to PNG via sharp, local storage behind existing StorageService); P1 PaddleOCR CPU docker sidecar (8.2% CER on receipts vs Tesseract ~40% on thermal) or LLM API; P2 LLM-vision structured extraction (Qwen3-VL via Ollama, or Claude Haiku — suggest-never-autofill). Reference: Receipt Wrangler.
- **libadwaita client**: needs REST API first. Stack: Rust+gtk-rs/relm4 (community default, 41.7% of GNOME Circle) or GJS+TypeScript (ts-for-gir v4, fastest for TS dev). Blueprint markup either way. Templates: NewsFlash (core-lib/UI split), Iotas (token auth + REST sync). NO client-server finance app exists in GNOME ecosystem — genuine gap.

## Envelope budget design (0.6) — mechanical reference

- YNAB model: assign only money you HAVE (vs EveryDollar which budgets expected income). Ready to Assign → envelopes → automatic rollover → move money freely ("roll with the punches").
- Overspending: reset to 0 at month boundary, deduct from next month's RTA; optional per-category carryover flag (Actual's `carryover`). YNAB distinguishes cash vs credit overspending — **credit handling is YNAB's #1 churn cause; avoid modeling it that way.**
- Actual Budget data model (reference impl): `zero_budgets` table, one row per (month=YYYYMM, category, amount, carryover, goal); budget mode orthogonal to ledger; hold-for-next-month op; targets = monthly/by-date/custom templates.
- Retrospend's current Budget model (limit-style, pegToActual/pegToLastMonth, isRollover) migrates cleanly: limits → assigned amounts.
- **Flagship differentiator: split-aware budgets** — only user's share of a shared expense hits their envelope; receivables visible; settlements auto-reconcile. Nobody has this (people run YNAB+Splitwise side by side).
- UX lessons: onboarding must avoid YNAB's 2–4-month learning curve; no overspending shame; "fresh start" feature; the "I just got paid, what now" moment is THE core flow to nail.

## Competitive landscape (July 2026)

- **Actual Budget** (27.5k★, healthy): best OSS envelope budgeting; NO multi-currency, NO splitting, no investments, no official mobile apps. Retrospend has all four.
- **Firefly III** (24k★): power-user ledger, dated UI, one maintainer, author explicitly anti-zero-based-budgeting.
- **Maybe Finance: dead** (archived 2025-07, 54k★); fork **Sure** (we-promise/sure, 9k★, very active) is the closest "superapp" competitor — watch it.
- **Splitwise**: paywall backlash (~3-4 expenses/day free cap since Dec 2023) created the OSS market. **Spliit dormant** (no release since Dec 2025, maintainer silent); **SplitPro active** (1.3k★). Spliit's #1 gaps: no accounts, no notifications, no multi-payer, no Android.
- Niche: Ghostfolio (investments), Wallos (subscriptions). Nobody integrates budgeting+splitting+wealth.
- Splitting space detail: Splitwise Pro $4.99/mo; free tier = ~3 expenses/day + 10s cooldown + ads. **#1 retention factor is network lock-in, not features** → group onboarding/invite UX matters as much as features. **Tricount** (bunq-owned, proprietary) is fully free/unlimited — the strongest non-self-hosted rival. Cospend (Nextcloud) actively maintained but needs Nextcloud; IHateMoney officially in maintenance mode.
- Universal self-hoster asks, ranked: **multi-user/household support #1**, then bank sync (SimpleFIN US/CA ~$1.50/mo; GoCardless killed free tier → Enable Banking for EU), mobile apps, OIDC/SSO, API, export, easy docker deploy. Household/partner budgeting deserves explicit roadmap consideration.
- YNAB+Splitwise pain verified hard: 7+ r/ynab threads on reconciling the two, YNAB publishes an official Splitwise workflow guide, and a *paid bridge tool* exists just to sync them — people pay money for a worse version of what split-aware budgets would do natively.

## Immich playbook (applies to 1.0 strategy)

API-first w/ OpenAPI-generated SDKs; mobile app that genuinely replaces the incumbent daily; 2–4 releases/month visible cadence; single docker-compose + published hardware minimums; live demo instance + demo mode; mission-first (privacy/ownership) messaging; honest "expect bugs" banner removed ceremonially at stable; year-in-review posts with real numbers; explicit mobile↔server compat guarantee at 1.0.

## Version plan (see roadmap.html)

0.4.4 fixes+ship → 0.5 web experience/mobile-responsive → 0.6 envelope budgeting (flagship) → 0.7 receipts/import/invoices → 0.8 public API+keys+OIDC → 0.9 Expo mobile alpha → 1.0 launch. Post-1.0: bank sync, GNOME client.
