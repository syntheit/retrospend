# React Native Port: Analysis & Game Plan

## 1. What's Already Done (Reusable As-Is)

### Entire Backend (~200 procedures)

The server is already a standalone API — nothing needs to change:

- **30 tRPC routers, ~200 procedures** — all business logic lives server-side
- **Services layer** (expense, wealth, budget, csv, settlement, etc.) — pure Node.js
- **Database + RLS** — completely decoupled from the frontend
- **Auth (better-auth)** — supports token-based auth, works with mobile clients
- **Image serving** (`/api/images/[...path]`) — already HTTP-based, works from any client
- **Notification system** — server-side creation, just need a mobile consumer

### Pure Logic in `src/lib/` (~20 files)

All of these are platform-agnostic and can be shared directly:

- `currency-math.ts`, `currencies.ts`, `currency-format.ts` — all currency conversion
- `csv.ts` — parsing/generation
- `date.ts`, `fiscal-month.ts` — date utilities
- `balance-utils.ts`, `recurring.ts` — business calculations
- `category-matcher.ts`, `category-colors.ts`, `category-icons.ts`
- `db-enums.ts`, `constants.ts`, `payment-links.ts`
- All Zod schemas (validation)

### tRPC Client

`@trpc/react-query` works in React Native — just swap the HTTP transport URL. All typed API calls, cache invalidation helpers (`query-invalidation.ts`), and React Query patterns transfer directly.

**Estimated reuse: ~35-40% of total codebase effort.**

---

## 2. What Needs to Be Rebuilt

- **All 194+ UI components** — shadcn/ui (Radix primitives) is web-only. Every component needs a native equivalent.
- **All hooks that touch browser APIs** — `localStorage`, `window.matchMedia`, `document.title`, `beforeunload`, etc.
- **Navigation** — Next.js app router → React Navigation / Expo Router
- **Charts** — Recharts (SVG/DOM) → `victory-native`, `react-native-chart-kit`, or `react-native-skia`

---

## 3. Page-by-Page Difficulty Assessment

| Page | Difficulty | Notes |
|------|-----------|-------|
| **Login / Signup / Auth flows** | Easy | Standard forms, well-supported in RN |
| **Dashboard** | Medium | Stats cards easy; area chart + donut chart need charting lib |
| **Transactions list** | Medium-Hard | Complex data table with filters, search, pagination, context menus, bulk selection. Tables are the hardest RN component. |
| **Budget** | Medium | List with inline editing, bullet charts, month navigation |
| **Wealth** | Medium-Hard | Multiple chart types (line, pie, allocation), privacy toggle, data table |
| **People** | Medium | Balance list, settle-up dialog, timeline |
| **People detail** | Easy-Medium | Activity list, balance breakdown |
| **Recurring** | Medium | Calendar view is non-trivial in RN, plus projections |
| **Projects list** | Easy-Medium | Card grid, context menus |
| **Project detail** | Hard | Most complex page — tabs, expense table, participants, settlements, activity feed, budget cards, billing periods |
| **Currencies** | Easy | Rate list, favorites |
| **Settings** | Medium | Many form sections, avatar crop/upload, category management |
| **Import (CSV/bank)** | Hard | File picker, editable preview table, job queue — may defer for mobile |
| **Admin panel** | Skip | Admin tasks are better on desktop |
| **Docs / Landing / Legal** | Skip | Not needed in mobile app |
| **Command palette** | Medium | Could become a search bar instead of Cmd+K |
| **Notifications** | Easy | Bell → native push notifications (actually better on mobile) |

---

## 4. Non-Trivial Challenges

### A. Data Tables

Heaviest UI pattern. TanStack Table + shadcn works beautifully on web but has no native equivalent at that quality level. Options:

- `react-native-table-component` (basic)
- Custom `FlatList`-based tables (most work, best result)
- `@shopify/flash-list` for performance
- Consider simplifying: mobile users likely want card-based lists, not full spreadsheet tables

### B. Charts

~15 chart components (area, donut, line, bullet, bar, allocation). Options:

- `victory-native` — mature, good API
- `react-native-chart-kit` — simpler
- `react-native-skia` + custom — most flexible, most work

### C. Image Cropping / Upload

`react-easy-crop` is web-only. Need `react-native-image-crop-picker` or `expo-image-picker` + `expo-image-manipulator`.

### D. Authentication Token Storage

Web uses cookies via better-auth. Mobile needs:

- `expo-secure-store` or `react-native-keychain` for token storage
- Better-auth supports bearer token mode — configure the client to send `Authorization: Bearer <token>` headers instead of cookies

### E. Push Notifications

Current system polls every 30s. Mobile should use native push:

- `expo-notifications` or `react-native-firebase`
- Server needs to store device tokens and send via APNs/FCM
- New tRPC procedure: `notification.registerDevice`

### F. Offline Support

Not in the web app, but mobile users expect some offline capability. React Query's persistence (`@tanstack/query-async-storage-persister`) can cache recent data, but writes would need queue-and-sync logic.

### G. File Export

`downloadCsv()` / `downloadPdf()` use browser `URL.createObjectURL`. Mobile needs:

- `expo-file-system` + `expo-sharing` for exports
- Or generate server-side and send download URL

---

## 5. Architecture

### Monorepo Structure

Keep everything in this same repo using a `packages/` structure:

```
retrospend/
├── apps/
│   ├── web/              ← current Next.js app (moved here)
│   └── mobile/           ← new Expo/React Native app
├── packages/
│   ├── shared/           ← extracted from src/lib/
│   │   ├── currency-math.ts
│   │   ├── currencies.ts
│   │   ├── date.ts
│   │   ├── fiscal-month.ts
│   │   ├── balance-utils.ts
│   │   ├── schemas/      ← Zod schemas
│   │   └── ...
│   ├── api/              ← tRPC router types + client setup
│   │   └── src/
│   │       ├── router-types.ts  ← AppRouter type export
│   │       └── client.ts
│   └── server/           ← current src/server/ (or stays in web)
├── prisma/
├── importer/
└── package.json          ← pnpm workspace
```

**Why this structure:**

- `packages/shared/` — pure logic used by both web and mobile
- `packages/api/` — tRPC `AppRouter` type export so mobile gets full type safety
- Server stays deployed as the same Next.js app (or extracted to standalone if needed later)
- Mobile connects to the same API endpoint

**Tooling:** Expo (managed workflow) — handles builds, OTA updates, and native modules. Expo Router for file-based navigation mirrors the Next.js mental model.

---

## 6. Effort Breakdown

| Category | % of Total Mobile Effort | Notes |
|----------|--------------------------|-------|
| **Project setup** (monorepo, Expo, navigation, auth) | 10% | One-time setup |
| **Shared package extraction** | 5% | Moving pure lib files |
| **Core screens** (dashboard, transactions, budget, wealth, people) | 40% | The bulk of the work |
| **Complex screens** (project detail, import, recurring calendar) | 20% | Hardest parts |
| **Settings + profile** | 8% | Forms, avatar upload |
| **Charts & data viz** | 10% | Picking a lib, adapting 15 charts |
| **Push notifications** | 4% | Server + client integration |
| **Polish** (animations, gestures, haptics) | 3% | What makes it feel native |

**Already done: ~35-40%** of the total effort (entire backend, business logic, type safety, API contracts).

**New work: ~60-65%** is UI — but it's "known" work (translating existing designs to native components), not new feature development.

---

## 7. Build Order

1. **Monorepo setup** + shared package extraction
2. **Auth flow** (login, signup, token storage)
3. **Dashboard** (proves the data pipeline works end-to-end)
4. **Transactions list** (most-used screen, validates table pattern)
5. **Expense create/edit** (core CRUD, validates forms)
6. **Budget** page
7. **Wealth** page
8. **People + settlements**
9. **Projects** (list → detail)
10. **Recurring**
11. **Settings**
12. **Push notifications**
13. **Import** (if needed on mobile at all)
