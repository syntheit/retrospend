# Retrospend Design Language Reference

> **Single source of truth for the app's modern look & feel.**
>
> This document **codifies patterns that already exist** in the four gold-standard pages —
> Transactions, Projects, Wealth, Settings — and their shared primitives. Applying this
> reference to an older page means **reusing these exact components and class strings**, not
> inventing new UI. When this doc and `docs/design-system.md` disagree, **this doc wins**,
> because it describes what is actually shipped in code (see "Reconciliation with
> design-system.md" at the end).

Gold-standard sources (study these before touching an older page):

- Transactions — `src/app/(dashboard)/transactions/page.tsx` (+ `_components/filter-bar.tsx`, `_components/expenses-table-footer.tsx`)
- Projects — `src/app/(dashboard)/projects/page.tsx` and `src/app/projects/[id]/page.tsx`
- Wealth — `src/app/(dashboard)/wealth/page.tsx` (+ `src/components/wealth/*`)
- Settings — `src/app/(dashboard)/settings/page.tsx` (+ `src/components/settings-form.tsx`)

Shared primitives live in `src/components/ui/`, `src/components/data-table.tsx`,
`src/components/site-header.tsx`, `src/components/page-content.tsx`.

---

## 1. Page Shell & Layout

Every dashboard page is built from **exactly two wrappers** — never hand-roll a header or
page padding.

### 1.1 The shell: `SiteHeader` + `PageContent`

```tsx
<>
  <SiteHeader title={t("title")} actions={/* optional */} />
  <PageContent>{/* or <PageContent fill> */}
    …
  </PageContent>
</>
```

- **`SiteHeader`** (`src/components/site-header.tsx`)
  - `<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b …">`
  - `--header-height` = `calc(var(--spacing) * 12)` (defined in `dashboard-layout.tsx`), i.e. **h-12 (48px)**.
  - Left: `SidebarTrigger` + a vertical `Separator` (`data-[orientation=vertical]:h-4`).
  - Title: `<h1 className="font-semibold text-lg tracking-tight">`. Pass a **string** for the standard title; pass a node only for breadcrumb pages (project detail).
  - Right cluster is auto-appended: `actions` → `FeedbackButton` → `NotificationBell`, wrapped in `ml-auto flex items-center gap-2`.
  - **Page-level action buttons go in the `actions` prop**, right-aligned. See Wealth: a `ghost`/`icon` privacy toggle plus a primary `size="sm"` "Add" button.

- **`PageContent`** (`src/components/page-content.tsx`)
  - **Default (scrolling) mode** — for card/grid pages (Projects, Settings):
    `flex flex-1 flex-col overflow-y-auto … pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+…)]`, inner `@container/main flex flex-col gap-2 px-4 lg:px-6` → `flex flex-col gap-4`.
  - **`fill` mode** — for full-height table pages (Transactions, Wealth). The content area fills height and the **child owns its own scroll**. Use with a `flex min-h-0 flex-1 flex-col` child.
  - **Horizontal padding is always `px-4 lg:px-6`** — never add your own page padding.

### 1.2 Content max-width

- Table / dashboard pages: **full width** (no max-width wrapper).
- Form / reading pages: **`mx-auto w-full max-w-4xl`** (Settings uses this literally):
  ```tsx
  <PageContent>
    <div className="mx-auto w-full max-w-4xl space-y-6">…</div>
  </PageContent>
  ```

### 1.3 Section spacing scale (the rhythm)

| Context | Class |
|---|---|
| Between major page sections (dashboards) | `gap-6` / `space-y-6` |
| Between related blocks / card grids | `gap-4` / `space-y-4` |
| Form sections stack (Settings) | `space-y-6` |
| Tight groups (filter rows, chip rows) | `gap-2` / `space-y-2` / `gap-1.5` |

Full-height pages open the content with `flex flex-1 flex-col gap-6 min-h-0` (Wealth) or
`flex min-h-0 flex-1 flex-col gap-4` (Transactions).

### 1.4 Grid patterns (use these exact breakpoints)

| Purpose | Class | Seen in |
|---|---|---|
| 4 summary stat cards | `grid gap-4 md:grid-cols-2 lg:grid-cols-4` | `NetWorthSummary` |
| 3 summary cards | `grid gap-4 md:grid-cols-3` | wealth `loading.tsx` |
| Chart + side panel (7/5 split) | `grid grid-cols-1 gap-6 lg:grid-cols-12` → `lg:col-span-7` / `lg:col-span-5` | Wealth |
| Card grid (auto-fill) | `grid gap-4` + inline `gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 400px), 1fr))"` | Projects |

> The design-system.md `lg:grid-cols-7` dashboard grid is realized in code as the **12-col
> 7/5 split** above — prefer the 12-col form.

---

## 2. Card Patterns

Base primitive: **`Card`** (`src/components/ui/card.tsx`) =
`flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm`.
`CardContent` = `px-6`; `CardHeader` = grid with `gap-2`; `CardTitle` = `font-semibold leading-none`; `CardDescription` = `text-muted-foreground text-sm`.

There are **three real card archetypes** in the gold-standard pages. Use the matching one; do
not invent gradient variants beyond these.

### 2.1 Plain card (structural container)

Wrap charts, forms, and content sections. Chart cards commonly override radius/height:

```tsx
<Card className="h-full">                 {/* wealth history chart – fills grid cell */}
<Card className="border border-border bg-card shadow-sm">  {/* portfolio breakdown */}
<Card className="border-border/50 shadow-sm">              {/* settings section */}
```

- `CardHeader className="flex flex-row items-center justify-between"` when the header has a title on the left and controls (ToggleGroup / picker) on the right.
- Content padding varies but stays on the 4/5/6 scale: `px-5 py-4` (compact panels), default `px-6` (`CardContent`).

### 2.2 Semantic summary card — **`StatCard`** (the real "semantic summary" pattern)

**This is the canonical secondary-metric card in shipped code** (`src/components/ui/stat-card.tsx`),
used by `NetWorthSummary`. It is a **spotlight** card, not a full gradient card: neutral
`bg-card` + a colored inset shadow + a blurred colored circle in the corner.

```tsx
<StatCard
  title={t("netWorth")}
  value={formatCurrency(...)}
  icon={Landmark}
  variant="emerald"        // neutral | blue | cyan | violet | amber | indigo | rose | emerald
  subValue={netWorthTrend} // optional node under the value
  description="…"          // optional right-aligned caption (mutually exclusive with trend)
  trend={{ value, label, intent }} // optional pill; positive=emerald, negative=destructive
/>
```

Structure & classes baked into `StatCard`:

- Card: `group relative h-32 overflow-hidden border border-border bg-card transition-all duration-300 hover:bg-accent/5` + `p-0`.
- **Spotlight circle** (per variant): `pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full blur-3xl` + e.g. `bg-emerald-500/20 dark:bg-emerald-500/30`.
- Inset color glow (per variant): e.g. `shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]`.
- Content: `relative z-10 flex h-full flex-col justify-between p-5`; top row = title (`text-muted-foreground text-sm`) + icon (`h-4 w-4` in variant color, e.g. `text-emerald-500`); value = `font-bold text-2xl text-foreground tabular-nums tracking-tight truncate`.
- **Trend pill**: `flex items-center gap-1.5 … rounded-full px-2 py-1 font-medium` — positive `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`, negative `bg-destructive/10 text-destructive dark:text-rose-400`, forced-neutral `bg-muted text-muted-foreground`, with `TrendingUp`/`TrendingDown` `h-3 w-3`.

**Always prefer `StatCard` for a colored KPI tile.** Do not hand-build the
emerald-50→white gradient card from design-system.md unless you are matching an existing
gradient block; the shipped standard is `StatCard`.

### 2.3 Hero / media card (dark-scrim gradient over imagery)

The real "hero" treatment in code is the **Project card** (`ProjectCard` in `projects/page.tsx`),
not a stat gradient. Use it for image-backed, tappable entities:

- Card: `group relative cursor-pointer overflow-hidden gap-0 p-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:brightness-[1.15] hover:shadow-xl active:translate-y-0 active:scale-[0.98] …`.
- Background: blurred cover image (`absolute inset-0 scale-110 bg-cover bg-center blur-xl`) **or** a type gradient `bg-gradient-to-br from-indigo-600 to-purple-700`.
- Dark scrim for legibility: `absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30`.
- On-image text is white with translucent tiers: `text-white`, `text-white/60`, `text-white/40`; badges use `bg-white/15 … backdrop-blur-sm`.
- Action footer: `flex items-center justify-between border-t border-white/10 bg-black/60 px-2 py-2 backdrop-blur-sm` with an overflow-aware button row (`ProjectCardFooter` measures with `ResizeObserver` and spills into a 3-dot `DropdownMenu`).

> The `stone-800→stone-900` net-worth hero and emerald/amber gradient cards described in
> design-system.md are **not** what the Wealth page ships today — Wealth uses `StatCard`s.
> Treat the dark-gradient hero as reserved for media/entity cards (Projects), and use
> `StatCard` for financial KPIs.

---

## 3. Semantic Color Usage

The color→meaning map is shared across `docs/design-system.md`, `StatCard` variants,
`getCategoryColorClasses` (`src/lib/constants.ts`), and chart constants
(`src/components/wealth/*`). Reuse these; do not introduce new hues for existing data types.

| Color | Meaning | Where it lives in code |
|---|---|---|
| **Emerald** `hsl(160 84% 39%)` | Assets, income, positive growth, "accept" | `StatCard variant="emerald"`; net-worth trend `text-emerald-500`; `Check` icon `text-emerald-500`; positive trend pill `bg-emerald-500/10 text-emerald-600` |
| **Blue** `hsl(217 91% 60%)` | Total assets, investments, main chart line/area | `StatCard variant="blue"`; wealth history `color: "hsl(217, 91%, 60%)"`; amortized badge `bg-blue-50 text-blue-700 ring-blue-700/10` |
| **Amber** `hsl(38 92% 50%)` | Liabilities, warnings, near-limit budget | `StatCard variant="amber"`; project budget 80–100% `text-amber-400 / bg-amber-400` |
| **Violet** `hsl(263 70% 50%)` | Crypto, runway, alternative/special | `StatCard variant="violet"` (runway); crypto allocation color |
| **Rose / Red** `hsl(0 84% 60%)` | Overspend, loss, negative, "reject", destructive | project budget >100% `text-rose-400 / bg-rose-400`; `X` reject icon `text-rose-500`; negative trend `text-destructive dark:text-rose-400` |
| **Cyan** `hsl(190 84% 50%)` | Transactions / neutral activity | `StatCard variant="cyan"`; chart palette |
| **Orange** `hsl(25 95% 53%)` | Other / miscellaneous / uncategorized | chart palette "OTHER" |
| **Indigo** | Project type gradient, misc accent | `from-indigo-600 to-purple-700`; `StatCard variant="indigo"` |
| **Neutral** | Zero / empty / disabled metric | `StatCard variant="neutral"` (e.g. liabilities when `=== 0`) |

Rules:

- Financial KPI tile → pick the `StatCard` variant matching the data type above.
- Category chips/badges → **always** go through `getCategoryColorClasses(color, variant)` /
  `CATEGORY_COLOR_MAP`; never hardcode a category's color at the call site.
- Charts → use the semantic hsl constants already defined in `wealth-history-chart.tsx` /
  `wealth-portfolio-breakdown.tsx` (`CURRENCY_COLORS`, `ASSET_COLORS`), not `var(--chart-N)`.
- Progress/utilization thresholds follow Projects: `>100% → rose`, `>80% → amber`, else
  `emerald` (bar) / `white/70` (text).

---

## 4. Data Tables

All tables render through the shared **`DataTable`** (`src/components/data-table.tsx`) with the
**`Table` primitives** (`src/components/ui/table.tsx`). Never build a raw `<table>` for list data.

### 4.1 Table shell & sticky chrome

- Outer frame: `relative overflow-hidden rounded-xl border`; in `fillHeight` mode `flex min-h-0 flex-1 flex-col`.
- Scroll container: `overflow-x-auto overflow-y-auto` + `min-h-0 flex-1` (fill) or `max-h-[48rem]` (default).
- **Sticky header**: `TableHeader` = `glass-surface sticky top-0 z-10 [&_tr]:border-b`. `glass-surface` (globals.css) = `color-mix(background 85%)` + `backdrop-filter: blur(8px) saturate(1.4)`.
- `TableHead` = `h-10 px-4 py-3 text-left align-middle font-medium text-muted-foreground text-sm`; sortable heads add a chevron cluster and `cursor-pointer`; header hover `hover:bg-muted/30`.
- `TableRow` = `border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted`.
- `TableCell` = `px-4 py-3 align-middle`; each cell wraps content in `flex min-h-7 items-center`.
- **Sticky footer** (totals): `TableFooter` = `sticky bottom-0 z-10 border-t bg-muted/95 font-medium backdrop-blur-sm`. Footer totals row uses `border-t-2 bg-muted/50 font-semibold` (see `expenses-table-footer.tsx`).

### 4.2 Cell conventions (from `data-table-columns.tsx`)

- **Amounts / numbers**: right-aligned, `text-right font-medium tabular-nums`; column meta `align: "right"`. Foreign/secondary price uses `cursor-help` + info icon `h-3 w-3`.
- **Title cell**: `flex items-center gap-2`, name `font-medium`; inline tag badges e.g. amortized `bg-blue-50 px-2 py-0.5 text-blue-700 text-xs ring-1 ring-blue-700/10` (+ `dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/30`), shared `…text-purple-700…`.
- **Category**: `CategoryChip` (colored via `getCategoryColorClasses`), centered, `size: 150`.
- **Column sizing**: use `meta.flex: true` for the elastic column; fixed columns set `size` (e.g. date 130, amount 160, actions 48).
- **Per-row "⋯" actions**: a `size="icon"` button, `h-8 w-8 md:opacity-0 transition-opacity md:group-hover:opacity-100` (hidden on desktop until row hover; always visible on mobile), icon `MoreHorizontal h-4 w-4`, `enableHiding: false`.

### 4.3 Selection, context menus, keyboard

- **Selection bar** (`DataTableSelectionBar`): an absolute overlay pinned to the header —
  `absolute top-0 left-0 z-20 flex w-full items-center gap-2 border-b bg-muted/95 px-4 backdrop-blur-sm transition-all duration-200`, animating `translate-y-0 opacity-100` ↔ `-translate-y-full opacity-0`. Passed into `DataTable` via `renderToolbar={(table, headerHeight) => …}`. Actions are `size="sm" variant="ghost"` buttons (`Edit`, `Copy`/duplicate, `Download`/export, `Tags`/recategorize), delete is `variant="destructive"`; labels collapse with `sr-only sm:not-sr-only`.
- **Right-click context menu**: pass `renderContextMenu={(row) => …}` returning `ContextMenuItem`s; destructive items use `variant="destructive"` + `Trash2`. State-aware submenus (e.g. recategorize search) live inside `ContextMenuSub`.
- **Keyboard** (built into `DataTable`): `Esc` clears selection, `Cmd/Ctrl+A` selects all, `E`/`Enter` edits the single selected row, `Delete`/`Backspace` deletes — all skipped when a dialog is open or an input is focused. Shift+click / shift+hover shows a range preview (`bg-muted/30`).

### 4.4 Mobile actions sheet

Per-row overflow and mobile row taps open a **detail/actions sheet** (`expense-actions-sheet.tsx`):

- Responsive: **mobile → `Drawer`** (bottom, `max-h-[85dvh]`, safe-area padding), **desktop → `Dialog`** (`sm:max-w-md`, `max-h-[85dvh] overflow-y-auto`).
- Details as a `dl`: `grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm`; labels `text-muted-foreground`, values `text-right`, amount `font-semibold tabular-nums`.
- Actions block: `flex flex-col gap-2 border-t pt-3`; each action is a full-width `h-11 w-full justify-start gap-2.5` button (`variant="outline"`, destructive where relevant); paired accept/reject use `grid grid-cols-2 gap-2`.
- Wire it up in the page via `onMobileRowActivate={(row) => setSheetId(row.id)}` on `DataTable`.

### 4.5 Empty states

Always use **`EmptyState`** (`src/components/ui/empty-state.tsx`) — never a bare "No results".

- Wrapper `flex flex-col items-center justify-center py-12 text-center`; icon in `mb-4 rounded-full bg-muted/50 p-3` with `h-8 w-8 text-muted-foreground`; title `font-medium text-foreground text-lg`; description `mt-1 max-w-[300px] text-muted-foreground text-sm`.
- Supports `action` (primary) and `secondaryAction` (default `outline`) in `mt-4 flex flex-wrap … gap-2`.
- Pass it into `DataTable` via `emptyState={<EmptyState … />}`; distinguish "no data yet" vs "no filter matches" with different title/description + a `Reset filters` secondary action (see Transactions).

---

## 5. Typography, Spacing, Icons, Motion

### 5.1 Type scale (recurring)

| Role | Class |
|---|---|
| Page title (`SiteHeader`) | `font-semibold text-lg tracking-tight` |
| Card title | `font-semibold leading-none` (`CardTitle`) |
| Section / entity name in card | `font-bold text-base` (project) / `font-bold text-2xl` (about, KPI value) |
| KPI value | `font-bold text-2xl tabular-nums tracking-tight` |
| Body / labels | `text-sm text-muted-foreground` |
| Micro-labels / captions | `text-xs` (or `text-[10px]/[11px]`), often `uppercase tracking-wide` for section labels |
| Any money / count | **always** add `tabular-nums` |

### 5.2 Iconography

- **Lucide is the app-wide icon library** (~97% of imports). Use `lucide-react` for all page/feature/table/action icons.
- `@tabler/icons-react` is **only** used in sidebar/nav shell (`app-sidebar.tsx`, `nav-*.tsx`). Do not introduce tabler icons in feature pages.
- Standard icon sizes: **`h-4 w-4`** default (buttons, table actions), `h-3 w-3`/`h-3.5 w-3.5` inline/nested, `h-5 w-5` card icon, `h-8 w-8` empty-state, `h-12 w-12` empty chart. Icons take `text-muted-foreground` or a semantic color.

### 5.3 Hover / transition conventions

- Cards: `transition-all duration-300 hover:bg-accent/5` (StatCard) or `hover:shadow-lg` (design-system) — keep `duration-300`.
- Interactive/media cards: `transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-xl active:scale-[0.98]` (Projects).
- Rows: `transition-colors hover:bg-muted/50`.
- Reveal-on-hover controls: `md:opacity-0 transition-opacity md:group-hover:opacity-100`.
- Overlays/bars: `transition-all duration-200` with translate+opacity.
- Buttons: base `transition-all`, focus ring `focus-visible:ring-[3px] focus-visible:ring-ring/50`, `rounded-lg`.

### 5.4 Buttons (`src/components/ui/button.tsx`)

- Variants: `default` (primary), `destructive`, `outline` (`shadow-xs`), `secondary`, `ghost`, `link`.
- Sizes: `default h-9`, `sm h-8` (**page header actions use `size="sm"`**), `lg h-10`, `icon size-9`, `icon-sm size-8`.
- Page primary action = `<Button size="sm"><Plus className="mr-2 h-4 w-4" /> {label}</Button>` in `SiteHeader.actions` (Wealth) or top-right of the toolbar (Projects).

### 5.5 Badges & chips

- `Badge` (`ui/badge.tsx`): `rounded-full border text-xs` (`px-2 py-0.5`); variants `default/secondary/destructive/outline`; `sm` = `text-[10px] px-1.5`.
- `Chip` (`ui/chip.tsx`): filter pill, `rounded-full px-3 py-1 text-xs font-medium`; active `bg-primary text-primary-foreground`, inactive `bg-muted/60 text-muted-foreground hover:bg-muted`.
- Status: `TransactionStatusBadge` maps active→emerald, pending→amber, settled→muted (the semantic map in §3).

---

## 6. Loading Skeletons (`loading.tsx`)

Every gold-standard route ships a `loading.tsx` that **mirrors the real page layout** with
`Skeleton` blocks. Match the page you are styling.

- `Skeleton` (`ui/skeleton.tsx`) = `animate-pulse rounded-md bg-accent`.
- Route loaders wrap content in `flex flex-1 flex-col gap-6 p-6` (with a staggered
  `skeleton-delayed-in` entrance), and reproduce the header (title `h-8 w-48` + action `h-9 w-36`), then the page's grid/table.
- Grid pages: replicate the exact grid — Projects `grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3` with `h-32 rounded-xl border p-4` cards; Wealth 3 summary cards + `h-[300px] rounded-xl` chart + table rows.
- Table pages: a header strip `px-4 py-3` + N rows `flex items-center gap-4 border-b px-4 py-3 last:border-b-0`.
- In-component loading (client `isLoading`) reuses the **same `SiteHeader` + `PageContent`
  shell** with `Skeleton` blocks in place of the real grid (see Wealth `page.tsx`), so the
  header/actions stay visible during load.
- Cards that own their loading pass `loading` to `StatCard` (it renders an internal
  `Skeleton className="h-8 w-24"` for the value).

---

## 7. Mobile & Responsive Conventions

- **Breakpoint hook**: `useIsMobile()` (`src/hooks/use-mobile.ts`), `MOBILE_BREAKPOINT = 768`
  (`< 768px` → mobile). Use this, not ad-hoc `window.innerWidth`.
- **Dialog vs Drawer**: use **`ResponsiveDialog`** (`ui/responsive-dialog.tsx`) — it renders a
  `Dialog` on desktop and a bottom `Sheet`/`Drawer` on mobile (`side="bottom"`,
  `max-h-[85dvh] overflow-y-auto rounded-t-xl`, drag handle `h-1 w-10 rounded-full bg-muted-foreground/30`). The actions sheet follows the same desktop-Dialog / mobile-Drawer split.
- **Tables → hide columns, not layout**: keep the `DataTable`; drop low-priority columns on
  mobile via `columnVisibility`. Transactions: `isMobile ? { category:false, localPrice:false } : {}`; Wealth: `{ select:false, allocation:false, balanceInUSD:false }`.
- **Mobile row tap** opens the actions sheet (`onMobileRowActivate`), not the edit modal.
- **Filter bars collapse**: filters live in a `Popover` on desktop, a bottom `Drawer`
  (`max-h-[70vh] overflow-y-auto`) on mobile (`filter-bar.tsx`).
- **Search**: use `ExpandableSearch` (`table-search.tsx`) — collapses to a `h-9 w-9` icon,
  expands to `w-36 sm:w-48 md:w-64`; `slashFocus` opens on `/`, `Esc` clears then collapses.
- Responsive stacks: header rows use `flex flex-col gap-3 sm:flex-row sm:items-center`
  (Wealth filters), about/danger rows `flex-col … md:flex-row`.

---

## 8. Consistency Checklist

Grade an older page against this. A page "feels consistent" when **all** are true:

1. **Shell** — uses `SiteHeader` (string title, `font-semibold text-lg tracking-tight`) + `PageContent` (`fill` for full-height table pages). No custom header/padding.
2. **Padding & width** — no page padding beyond `PageContent`'s `px-4 lg:px-6`; form/reading content wrapped in `mx-auto w-full max-w-4xl`.
3. **Spacing rhythm** — sections on `gap-6/space-y-6`, groups on `gap-4`, tight rows on `gap-2` — no arbitrary margins.
4. **Cards** — every container is `Card` (`rounded-xl border bg-card shadow-sm`); KPI tiles are `StatCard` with the correct semantic `variant`; no bespoke gradient KPI cards.
5. **Semantic color** — data-type colors match §3 (emerald=assets/positive, amber=liabilities/warning, rose=negative, blue=main/investment, etc.); category colors via `getCategoryColorClasses`; charts via the shared hsl constants.
6. **Tables** — list data uses `DataTable` + `ui/table` primitives (sticky `glass-surface` header, `hover:bg-muted/50` rows, `tabular-nums text-right` amounts, `px-4 py-3` cells), not a raw table.
7. **Table affordances** — selection via `DataTableSelectionBar` (`renderToolbar`), right-click via `renderContextMenu`, per-row `⋯` (`md:opacity-0 group-hover:opacity-100`), keyboard shortcuts inherited from `DataTable`.
8. **Empty states** — `EmptyState` component (icon-in-`bg-muted/50`, title `text-lg`, muted description, primary + `Reset filters` secondary), never a plain string.
9. **Actions** — primary action is a `Button size="sm"` with a leading `h-4 w-4` lucide icon, placed in `SiteHeader.actions` or top-right of the toolbar; destructive actions are `variant="destructive"` + `Trash2` and go through a confirm `Dialog`/`ConfirmationDialog`.
10. **Icons** — lucide only (no tabler in feature pages); `h-4 w-4` default sizing; semantic/muted colors.
11. **Motion** — cards `transition-all duration-300`, rows `transition-colors`, reveal-on-hover `md:group-hover:opacity-100`; no instant state flips.
12. **Loading** — a `loading.tsx` (and/or in-component `isLoading`) that mirrors the layout with `Skeleton` blocks and keeps the shell visible.
13. **Responsive** — `useIsMobile()` for branching; `ResponsiveDialog` for modals; tables drop columns via `columnVisibility` (never reflow to bespoke cards); `ExpandableSearch` for search; filters in `Popover`→`Drawer`.

---

## 9. Reconciliation with `docs/design-system.md`

`docs/design-system.md` documents **intent and the color system** (authoritative for the
color→meaning map and chart palettes). Where it describes card *implementations*, prefer the
**as-shipped** patterns below:

- **Hero card** — the doc's `stone-800→stone-900` net-worth hero is **not** on the Wealth page
  today; Wealth uses `StatCard`s. The dark-gradient-over-imagery hero is realized as the
  **Project card**. Use `StatCard` for financial KPIs; reserve the dark-scrim gradient for
  media/entity cards.
- **Semantic summary cards** — the doc's `from-emerald-50 to-white` gradient card is superseded
  in code by **`StatCard`** (neutral card + colored spotlight + inset glow). Use `StatCard`.
- **Dashboard 7-col grid** — realized as the **12-col 7/5 split** (`lg:grid-cols-12` +
  `lg:col-span-7`/`lg:col-span-5`).
- **Everything else** in design-system.md (color HSLs, chart colors, hover/duration guidance,
  DO/DON'T list) is consistent with shipped code and remains authoritative.

---

_Derived from Transactions, Projects, Wealth, and Settings as of this branch. Update this file
whenever those pages change so it stays the single source of truth._
