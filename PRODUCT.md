# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

One product designed together for the web (desktop and responsive mobile web), iOS, Android and
Linux phones (GNOME/libadwaita, plus one more Linux-phone toolkit). Shared across platforms: data
visualizations, color meaning, number and currency formatting, naming and information architecture.
Native per platform: navigation chrome, sheets and dialogs, pickers, gestures. The owner's rule:
"familiar, not the same". If the UI and visualizations differ completely across platforms, it feels
like different apps.

Today the web app and one Expo app for iPhone, iPad and Android exist. The Android app works
fully without Google services. Linux phone clients are planned on the public API.

## Users

Everyone who manages money, with no single primary persona. These groups are all first-class:

- **People who share costs:** friends, partners, roommates and travel groups splitting expenses,
  often across currencies. Participants may not have an account.
- **Budgeters:** people who want every unit of money assigned and tracked. Many run YNAB and
  Splitwise side by side today and reconcile them by hand.
- **Multi-currency and high-inflation users:** people living across currencies, for example ARS
  with official and blue rates, who need real numbers in a stable reference currency.
- **Privacy-minded self-hosters:** people who want to own their financial data and run it on
  their own hardware.

The owner uses it daily with ARS as home currency. Every money feature must work for any home
currency (USD, ARS, BRL and so on).

## Product Purpose

Retrospend is the "Immich of finance". It is one well-integrated financial superapp: expense
tracking, budgeting, shared expenses and wealth. It respects privacy, costs nothing, and runs on
your own hardware or on the free hosted instance at retrospend.app.

Success means people stop juggling separate apps for budgeting, splitting and net worth, and they
trust the numbers.

## Positioning

The core difference is two linked ideas.

- **Split-aware envelope budgets.** When you split an expense, only your share hits your budget.
  A friend's debt shows as a receivable next to your envelopes, and settling up reconciles both.
- **Person-centric balances.** All debts with one person roll into one number across every
  project. No groups are required for a quick split.

Neither a budgeting app nor a splitting app can claim both, because they own only half the data.

## Operating Context

- **Daily expense entry,** often on a phone, often in a foreign or non-home currency, with a
  choice of exchange rate (for example official vs blue).
- **Shared spending:** trips, households and one-off splits. Then settle up: record a payment,
  the payee confirms it, and there is a full audit trail. Payment deep links (Venmo, PayPal and
  so on).
- **Monthly budgeting,** moving toward a YNAB-style flow: when income arrives, assign it to jobs
  right then. "Every dollar has a job." "It cannot be messy."
- **Wealth tracking:** assets, liabilities, crypto, and net worth over time.
- **Bank statement import** (CSV and PDF, AI-assisted).
- **Self-hosting with Docker.** The hosted instance and self-hosted instances should interoperate
  (federation, planned).

## Capabilities and Constraints

**Exists:**
- expenses and income with categories, tags and filters
- multi-currency with daily rates and real rate types (official, blue, card, MEP)
- envelope budgets with eight styles on one engine
- recurring expenses and income
- wealth and net worth, with deliberate money moves (income, transfer, exchange)
- people and projects with splits; settle up with payment groups
- guest participants via magic links; public profile and pay pages
- preview and undo on every money action
- PDF and CSV export
- AI bank import (Ollama/OpenRouter)
- 2FA, an admin panel and invite codes
- the public API (`/api/v1`, OpenAPI, scoped tokens, device login, webhooks)
- the Expo app for iPhone, iPad and Android, offline-first, with push

**Planned:**
- receipts and documents
- a shared household budget
- an import redo with BYOK AI keys
- Linux phone clients (GNOME/libadwaita)
- a CLI with a browser-style login
- an MCP server
- end-to-end encryption (opt-in)
- federation
- high availability

**Money rules:**
- Amounts are stored with their currency, plus a USD reference value.
- A missing exchange rate is an error, never treated as 1.
- Totals use same-currency amounts as entered.

**Time:** dates follow the user's time zone.

**AI must be tasteful.** It should be zero-effort and actually useful, for example suggesting new
categories from spending. There is no "AI button everywhere" and no generated finance reports.
The default models are cheap ones.

## Brand Commitments

- **Name:** Retrospend.
- **Pillars:** Private, Free, Integrated, Simple, Open.
- **Copy:** plain and direct, US English. Never use em dashes anywhere.

## Evidence on Hand

- Real product: the live app at retrospend.app, used daily by the owner and the people they
  split with.
- Architecture and decisions: `docs/architecture/ARCHITECTURE.md`. Design rules: `docs/ui/`.
  The maintainer keeps research, mockups and roadmap notes outside the repository.
- **No testimonials, user counts, press or benchmarks exist.** Do not invent them.

## Product Principles

1. **One system, not modules.** Budget, splits, people and wealth read the same numbers and link
   to each other. The app should feel connected.
2. **Trustworthy numbers.** Each calculation is defined once and is correct in every currency. A
   wrong total is worse than a missing feature.
3. **Change with a reason.** Keep what works. Improve what doesn't. Never change just to change.
4. **Familiar on every platform.** Same meaning, same visuals for data, native feel for chrome
   and input.
5. **Quiet, useful automation.** Help that costs the user zero effort, never slop.
