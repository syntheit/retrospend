# Currencies Page — Alignment Plan

> **Scope:** Close the clearest gaps between the Currencies page and the app's
> design language (codified in `design-language.md`). The owner notes this page
> is dated "to an extent," so this is a **light-touch pass**, not a full overhaul.
> All functionality (rates table, favorites, calculator, sync, search, drag-reorder,
> context menus) is preserved unchanged.
>
> Files analysed:
> - `src/app/(dashboard)/currencies/page.tsx`
> - `src/app/(dashboard)/currencies/loading.tsx`
> - `src/components/exchange-rates-table.tsx`
> - `src/components/favorite-currency-cards.tsx`
> - `src/components/currency-calculator.tsx`

---

## Issue 1 — In-component loading state: bare text, not Skeleton blocks

**Severity:** Quick win  
**Priority:** High — violates the gold-standard pattern most visibly.

### Current (dated)
`page.tsx:72–80` — `isLoading` renders:
```tsx
<div className="flex h-64 items-center justify-center">
  <div className="text-muted-foreground">{t("loadingRates")}</div>
</div>
```
A spinner-free, layout-collapsing text string inside the full shell.

### Reference pattern
`design-language.md §6` — Wealth's in-component `isLoading` branch (wealth
`page.tsx:117–141`) keeps `SiteHeader` + `PageContent` visible and fills the
content area with `Skeleton` blocks that mirror the real page grid. Blocks use
`animate-pulse rounded-md bg-accent` (`Skeleton` component).

### What to do
Replace the `isLoading` early-return with a Skeleton layout that matches the
page's two-column structure:
- Left column: `Skeleton className="h-9 w-48"` (tabs bar) + `Skeleton`
  header strip + 8 row skeletons `h-10 rounded-none border-b`.
- Right column: `Skeleton className="h-[220px] rounded-xl"` (calculator) +
  3 compact card skeletons `h-14 rounded-xl`.

Keep `<PageLayout>` (i.e. `SiteHeader` + `PageContent fill`) wrapping the
skeleton so the header stays visible during load — exactly as Wealth does.

### What stays
Page shell, both columns, gap structure.

---

## Issue 2 — In-component error state: bare text

**Severity:** Quick win  
**Priority:** Medium — same pattern as Issue 1.

### Current (dated)
`page.tsx:83–90` — renders a raw `<div className="text-destructive">` inside a
centered `h-64` block. No icon, no retry action.

### Reference pattern
`design-language.md §4.5` — `EmptyState` (`src/components/ui/empty-state.tsx`)
with `action` prop for a retry. Icon in `mb-4 rounded-full bg-muted/50 p-3`,
description `text-muted-foreground text-sm`, title `text-lg font-medium`.

### What to do
Replace the error early-return with:
```tsx
<EmptyState
  icon={AlertCircle}              // lucide, already used app-wide for errors
  title={t("errorTitle")}
  description={error.message}
  action={{ label: t("retry"), onClick: () => void refetch() }}
/>
```
Wrap in the existing `<PageLayout>` shell.  
**Ambiguous call:** `refetch` would need to be exposed from
`useExchangeRatesController`; confirm before adding.

### What stays
Destructive semantic for errors stays; just upgrade the container.

---

## Issue 3 — ExchangeRatesTable empty state: bare `<div>` text, not `EmptyState`

**Severity:** Quick win  
**Priority:** Medium.

### Current (dated)
`exchange-rates-table.tsx:664–668`:
```tsx
emptyState={
  <div className="py-8 text-muted-foreground text-sm">
    {t("noExchangeRatesFound")}
  </div>
}
```

### Reference pattern
`design-language.md §4.5` — `EmptyState` with icon-in-`bg-muted/50`, title
`font-medium text-lg`, description `text-muted-foreground text-sm`. Pass a
`secondaryAction` for "Clear search" when `searchQuery` is non-empty.

### What to do
Replace the bare `<div>` with:
```tsx
emptyState={
  <EmptyState
    icon={Search}
    title={t("noExchangeRatesFound")}
    description={searchQuery ? t("tryDifferentSearch") : undefined}
    secondaryAction={searchQuery ? { label: t("clearSearch"), onClick: () => setSearchQuery("") } : undefined}
  />
}
```

### What stays
Search logic, filter, all table affordances.

---

## Issue 4 — FavoriteCurrencyCards loading state: dashed-border text box

**Severity:** Quick win  
**Priority:** Medium.

### Current (dated)
`page.tsx:154–157`:
```tsx
<div className="rounded-lg border border-dashed border-muted p-4 text-center text-muted-foreground text-sm">
  {t("loadingFavorites")}
</div>
```
A bespoke dashed container that has no analog in the design language.

### Reference pattern
`design-language.md §6` — in-component loading uses `Skeleton` blocks. For a
compact list, 3 stacked `Skeleton className="h-14 w-full rounded-xl"` items
match the compact card height.

### What to do
Replace with:
```tsx
<div className="flex flex-col gap-2">
  {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
</div>
```

### What stays
`FavoriteCurrencyCards` component and its empty state (`EmptyState` already
used correctly at `favorite-currency-cards.tsx:113–123` — no change needed).

---

## Issue 5 — Favorite card hover/transition: `transition-shadow` instead of `transition-all`

**Severity:** Quick win  
**Priority:** Low.

### Current (dated)
`favorite-currency-cards.tsx:286, 357`:
```tsx
className={cn("transition-shadow", ...)}
```
`transition-shadow` is not a standard Tailwind utility (it doesn't exist as a
named class); in practice the browser silently applies no transition, making
hover interactions snappy rather than smooth.

### Reference pattern
`design-language.md §5.3` — cards use `transition-all duration-300` (StatCard)
or `transition-all duration-200 ease-out` (ProjectCard). For a plain content
card, `transition-all duration-200` is appropriate.

### What to do
Replace both instances:
```tsx
"transition-all duration-200"
```
Also add `hover:shadow-md` alongside (already present) — no change to hover
shadow itself, just ensure the transition fires.

### What stays
All click handling, drag states, card layout.

---

## Issue 6 — `loading.tsx` does not use the SiteHeader + PageContent shell

**Severity:** Small / proportionate  
**Priority:** Low — the route-level loading skeleton is a secondary UX moment.

### Current (dated)
`loading.tsx:4–48` — renders a bare `<div className="flex flex-1 flex-col gap-6 p-6">` with a hand-built header skeleton `<Skeleton className="h-8 w-48" />` + `<Skeleton className="h-9 w-32" />`. The real page uses `<PageContent fill>` (which provides `px-4 lg:px-6`), so the skeleton padding (`p-6`) doesn't match, and the sidebar trigger + page chrome are invisible during the loading flash.

Also: three tab skeletons are rendered (the current page has only two: Fiat, Crypto), and the skeleton shows a right action skeleton (`h-9 w-32`) that the real page does not have (no header action button).

### Reference pattern
`design-language.md §6` — loading files wrap with `flex flex-1 flex-col gap-6 p-6` with `skeleton-delayed-in`. Wealth/Transactions follow the same bare-div convention (not importing `SiteHeader`), so staying bare is acceptable. What should change is: match the real page's two-column grid `lg:grid-cols-[1fr_320px]`, drop the spurious third tab, and remove the action-button skeleton since the page has none.

### What to do
- Remove the extra tab skeleton (keep two: `h-9 w-24` × 2).
- Remove the `h-9 w-32` action button skeleton (right side of header row).
- Change the main grid from the current single-column arrangement to
  `grid gap-4 lg:grid-cols-[1fr_320px]` mirroring the real layout.
- The right sidebar skeleton: `Skeleton h-[220px] rounded-xl` (calculator) +
  3 × `Skeleton h-14 rounded-xl` (compact favorites).

### What stays
`skeleton-delayed-in` animation, Skeleton component, gap-6 spacing.

---

## Issue 7 — `h-7 w-7` per-row overflow button (minor size mismatch)

**Severity:** Micro / proportionate  
**Priority:** Low.

### Current (dated)
`exchange-rates-table.tsx:354`:
```tsx
className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100 data-[state=open]:opacity-100"
```

### Reference pattern
`design-language.md §4.2` — "per-row '⋯' actions: `h-8 w-8`". Most gold-standard columns use `h-8 w-8` (`data-table-columns.tsx:344`); `h-7 w-7` appears in some secondary spots but `h-8 w-8` is the canonical size.

### What to do
Change `h-7 w-7` → `h-8 w-8` on the `MoreHorizontal` button.

### What stays
`md:opacity-0 transition-opacity md:group-hover:opacity-100` already correct.

---

## What stays (no change needed)

| Area | Assessment |
|---|---|
| Page shell | `SiteHeader` + `PageContent fill` already used correctly. |
| Page padding | No extra padding added beyond `PageContent`; correct. |
| Section spacing | `gap-6` between columns, `gap-4` in sidebar — correct rhythm. |
| DataTable usage | `ExchangeRatesTable` wraps `DataTable` with `fillHeight`, sticky header, `glass-surface`, `hover:bg-muted/50` rows, `px-4 py-3` cells — all correct. |
| Context menus | `renderContextMenu`-equivalent (`renderRow` + `ContextMenu`) is correct. |
| Per-row reveal-on-hover | `md:opacity-0 md:group-hover:opacity-100` already present. |
| `ExpandableSearch` | Already used, `slashFocus` wired — correct. |
| Icon library | Lucide throughout, no Tabler icons — correct. |
| `tabular-nums` on amounts | Present in rate columns and calculator inputs — correct. |
| `EmptyState` in favorites | Already used at `favorite-currency-cards.tsx:116` — correct. |
| Responsive column | `columnVisibility meta.className: "hidden md:table-cell"` on Type column — correct. |
| Calculator card | `Card` + `CardContent` with `Chip` rate strip — correct primitives. |
| Semantic colors | No semantic color mismatches found (heart uses `text-destructive` correctly; muted-foreground for labels correct). |

---

## Summary table

| # | File | Issue | Quick win? | Effort |
|---|---|---|---|---|
| 1 | `page.tsx:72–80` | isLoading: bare text → Skeleton blocks | Yes | ~30 min |
| 2 | `page.tsx:83–90` | error: bare text → `EmptyState` | Yes | ~15 min |
| 3 | `exchange-rates-table.tsx:664` | table empty state: bare div → `EmptyState` | Yes | ~10 min |
| 4 | `page.tsx:154–157` | favorites loading: dashed box → Skeleton | Yes | ~5 min |
| 5 | `favorite-currency-cards.tsx:286,357` | `transition-shadow` → `transition-all duration-200` | Yes | ~5 min |
| 6 | `loading.tsx` | route skeleton: wrong col count, spurious skeletons | No | ~20 min |
| 7 | `exchange-rates-table.tsx:354` | overflow button `h-7 w-7` → `h-8 w-8` | Yes | ~2 min |
