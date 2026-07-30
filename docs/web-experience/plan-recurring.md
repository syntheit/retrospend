# Recurring Page — Modernization Plan

> **Scope:** bring `src/app/(dashboard)/recurring/` in line with the codified
> [`design-language.md`](./design-language.md). This is a **reuse** plan: every change below adopts an
> **existing** component / class string from the four gold-standard pages (Transactions, Projects,
> Wealth, Settings). No net-new visual concepts. **All functionality is preserved** — calendar,
> projections, pending confirmation, history drawer, stats, search, sort, pause/resume, delete.
>
> Files in scope:
> - `page.tsx`
> - `loading.tsx`
> - `_components/recurring-stats-cards.tsx`
> - `_components/pending-payments.tsx`
> - `_components/recurring-list.tsx`
> - `_components/recurring-calendar.tsx`
> - `_components/recurring-projections.tsx`
> - `_components/recurring-history-drawer.tsx`
> - `_components/renewal-timeline.tsx`

---

## Executive summary — top divergences

The page already reaches for several modern primitives (`SiteHeader`, `PageContent`, `StatCard`,
`EmptyState`, `ExpandableSearch`, `ResponsiveDialog`-family via `Sheet`). What makes it read as
"dated" against the gold-standard pages:

1. **The subscription list is a hand-rolled `div` list, not a `DataTable`.** This is the single
   biggest divergence — checklist items 6 & 7. Reference list data (Transactions, Wealth) always
   goes through `DataTable` + `ui/table` primitives with a sticky `glass-surface` header,
   `tabular-nums text-right` amounts, per-row `⋯` reveal-on-hover, and inherited keyboard/selection.
2. **The primary "Add" action lives in a custom toolbar as a `size="default"` button**, not in
   `SiteHeader.actions` as `size="sm"` (checklist item 9; Wealth/Projects pattern).
3. **Off-palette semantic colors.** `useRecurringStatus` uses `text-orange-500` for due/overdue
   states; §3 reserves **amber** for warnings/near-due and **rose/destructive** for overdue. Orange
   is reserved for "other/uncategorized".
4. **Bespoke panels instead of `Card`.** Pending payments, the calendar, and the projections toggle
   are custom bordered `div`s / ad-hoc gradient panels rather than `Card` (`rounded-xl border
   bg-card shadow-sm`) — checklist item 4.
5. **`loading.tsx` does not mirror the real layout** and hardcodes generic list/stat skeletons
   rather than the `SiteHeader` shell + the actual grid/table (checklist item 12, §6).
6. **Dead code:** `renewal-timeline.tsx` is defined but never imported or rendered anywhere in the
   app. Decision needed (see §9).

Everything below is grouped by section, tagged **[Quick win]** (class/prop swap, no structural
change) or **[Larger]** (structural refactor), with **[Ambiguous — owner]** flags where a call is a
judgment about layout or product behavior rather than pure style conformance.

---

## 1. Page shell (`page.tsx`)

### 1.1 Move the primary action into `SiteHeader.actions` — [Quick win]

- **Current (dated):** `page.tsx:156` renders `<SiteHeader title={t("title")} />` with **no
  actions**, and the "Add recurring" button is a default-size `<Button>` buried inside the
  subscriptions toolbar at `page.tsx:223-229` (`<Plus className="h-4 w-4 sm:mr-2" />`).
- **Reference pattern:** §1.1 / §5.4 / checklist 9 — "Page primary action = `<Button size="sm">
  <Plus className="mr-2 h-4 w-4" /> {label}</Button>` in `SiteHeader.actions`." Wealth (`wealth/page.tsx:120-152`)
  passes its "Add" button (and a ghost/icon toggle) via the `actions` prop.
- **Adopt:**
  ```tsx
  <SiteHeader
    title={t("title")}
    actions={
      <Button size="sm" onClick={openNewRecurring}>
        <Plus className="mr-2 h-4 w-4" />
        {t("addRecurring")}
      </Button>
    }
  />
  ```
  Remove the button from the subscriptions toolbar. Keep `openNewRecurring` wiring unchanged.
- **Stays:** search + sort controls stay in the list toolbar (they are list-scoped, like Transactions'
  filter bar). Only the create action promotes to the header.

### 1.2 Content width & column layout — [Ambiguous — owner]

- **Current:** `page.tsx:158-260` wraps everything in `mx-auto w-full max-w-6xl` and lays out a
  **two-column flex** (`flex items-start gap-6`) with a `280px` sticky `<aside>` (calendar +
  projections) on the right.
- **Reference tension:** §1.2 says table/dashboard pages are **full width (no max-width wrapper)**;
  the `max-w-4xl` wrapper is reserved for form/reading pages (Settings). §1.4 codifies the
  chart+side-panel split as the **12-col 7/5 grid** (`grid grid-cols-1 gap-6 lg:grid-cols-12` →
  `lg:col-span-7` / `lg:col-span-5`), used by Wealth — not an ad-hoc flex + fixed-`px` aside.
- **Adopt (recommended):** drop `max-w-6xl`; convert the two-column region to the reference 12-col
  split so the calendar/projections sidebar matches Wealth:
  ```tsx
  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
    <div className="min-w-0 lg:col-span-8 space-y-6"> {/* main */} </div>
    <aside className="lg:col-span-4 space-y-6"> {/* calendar + projections */} </aside>
  </div>
  ```
  (7/5 is the canonical split; 8/4 is acceptable if the subscription table needs the extra width — a
  layout judgment for the owner.) Keep the `sticky top-6` on the aside if the owner wants it pinned —
  it is a reasonable behavior, just not part of the reference grid.
- **Owner decision:** (a) full-width vs. keep a max-width cap; (b) 7/5 vs 8/4 column ratio;
  (c) whether the sidebar stays `sticky`. These are layout product-calls, not pure conformance.
- **Stays:** the "hidden below `lg`, hidden when no templates" behavior of the aside is fine — that is
  the responsive convention (hide low-priority region on mobile).

### 1.3 Section rhythm — [Quick win]

- **Current:** the subscriptions block uses `space-y-3` (`page.tsx:182`) for the header→list gap.
- **Reference:** §1.3 — tight groups are `gap-2`, related blocks are `gap-4`, major sections `gap-6`.
  `space-y-3` is off-scale.
- **Adopt:** use `space-y-4` between the toolbar header and the list (related blocks), keep the
  outer `space-y-6` between major sections (`page.tsx:161`). Minor, but removes an arbitrary value.

---

## 2. Subscription list — `recurring-list.tsx` (largest item)

### 2.1 Replace the hand-rolled row list with `DataTable` — [Larger]

- **Current (dated):** `recurring-list.tsx:85-98` renders `<div className="flex flex-col divide-y
  … rounded-xl border">` and maps custom `RecurringRow` `div`s (`:191-316`). This is a bespoke list,
  exactly what §4 / checklist 6 forbids for list data ("Never build a raw `<table>` for list data").
- **Reference pattern:** §4 — all list data renders through **`DataTable`** (`src/components/data-table.tsx`)
  with the `ui/table` primitives, as in Transactions (`transactions/page.tsx` + `data-table-columns.tsx`)
  and Wealth. Adopt:
  - **Shell** (§4.1): sticky `glass-surface` header, `TableRow` `hover:bg-muted/50`, `TableCell`
    `px-4 py-3`.
  - **Columns** (§4.2):
    - **Name/brand cell** — `flex items-center gap-2`; keep the `BrandIcon` in its rounded tile, name
      `font-medium`; move the paused state to an inline badge (see 2.3). Mark this the elastic column
      via `meta.flex: true`.
    - **Category** — `CategoryChip` centered, `size: 150` (already using `CategoryChip`; just moves
      into a column). Hide on mobile via `columnVisibility` per §7.
    - **Frequency / status** — a compact text column (or fold "renews in N days" into a subtitle);
      status text uses semantic color per 2.4.
    - **Amount** — **right-aligned** `text-right font-medium tabular-nums`, column `meta.align:
      "right"`, `size: 160` (currently the amount is `font-semibold text-base tabular-nums`, left of a
      menu button — reposition to the standard right-aligned amount column).
    - **Actions** — per-row `⋯` column, `enableHiding: false`, `size: 48`.
- **Stays:** all row actions (edit, pause/resume, view history, visit website, delete), the
  `onEdit`-on-row-click behavior, `BrandIcon`, `CategoryChip`, currency formatting, and the paused
  dimming semantics. Only the **rendering substrate** changes.

### 2.2 Per-row actions → standard `⋯` + `renderContextMenu` — [Larger]

- **Current (dated):** `recurring-list.tsx:243-284` uses a `DropdownMenu` triggered by a
  `MoreVertical` button styled `h-7 w-7 … opacity-50 … hover:opacity-100`, plus a parallel
  `ContextMenu` (`:288-314`) that duplicates the same action list.
- **Reference pattern:** §4.2 / §4.3 —
  - Per-row overflow button is `size="icon"` `h-8 w-8 md:opacity-0 transition-opacity
    md:group-hover:opacity-100` with **`MoreHorizontal`** (not `MoreVertical`) `h-4 w-4`. Reveal-on-hover
    on desktop, always visible on mobile.
  - Right-click uses `DataTable`'s `renderContextMenu={(row) => …}` returning `ContextMenuItem`s;
    destructive item uses `variant="destructive"` + `Trash2`.
- **Adopt:** keep the existing `useRowMenuActions` action list (it already maps cleanly to menu
  items) and feed it into both the `⋯` `DropdownMenu` and `renderContextMenu`. Swap
  `MoreVertical`→`MoreHorizontal`, `h-7 w-7 opacity-50`→`h-8 w-8 md:opacity-0
  md:group-hover:opacity-100`.
- **Stays:** the action set, the `href` "visit website" special-case, `variant="destructive"` on
  delete, and the separator before delete.

### 2.3 Paused badge & dimming — [Quick win]

- **Current:** paused rows get `opacity-50` on the whole row (`recurring-list.tsx:197`) and a
  `Badge variant="secondary" text-[10px]` (`:218`).
- **Reference:** §5.5 — status is expressed via a `Badge`/status badge, not by dimming the entire
  row; `TransactionStatusBadge` maps active→emerald, pending→amber, settled→muted.
- **Adopt:** keep a small `Badge` for the paused state (secondary/muted is on-map for a
  disabled/neutral metric per §3). **[Ambiguous — owner]:** whether to keep the full-row `opacity-50`.
  It reads as dated but is a legible "this is paused" cue; recommend replacing whole-row opacity with
  a muted amount + the badge, but leave the final call to the owner.

### 2.4 Status color → semantic map — [Quick win]

- **Current (dated):** `src/hooks/use-recurring-status.ts:54-59` returns `text-orange-500` for
  "renewing today" and "due in N days", and `text-destructive` for overdue.
- **Reference:** §3 color→meaning map — **amber** = warnings / near-due; **rose/destructive** =
  overdue/negative; **orange** is reserved for "other/uncategorized" and must not be used for
  near-due states.
- **Adopt:** change the near-due/today `text-orange-500` → `text-amber-600 dark:text-amber-400`
  (matching `StatCard variant="amber"` icon color and §3). Keep overdue on `text-destructive`.
- **Note:** this hook is shared — confirm no other consumer depends on the orange; grep shows only
  the recurring list uses it, so this is a safe, contained swap.

### 2.5 Loading & empty states — [Quick win]

- **Current:** loading is three `h-[72px] animate-pulse rounded-xl bg-muted` bars
  (`recurring-list.tsx:62-70`); empty wraps `EmptyState` in a `rounded-xl border border-dashed`
  (`:72-83`).
- **Reference:** §4.5 / §6 — `EmptyState` is passed into `DataTable` via `emptyState={…}` (no dashed
  wrapper needed once inside the table frame); table loading is a header strip + N skeleton rows
  `flex items-center gap-4 border-b px-4 py-3`.
- **Adopt:** move `EmptyState` to the `DataTable emptyState` slot. Distinguish "no subscriptions
  yet" (primary action = Add) from "no search matches" with a different title/description + a **Reset
  filters** `secondaryAction` (Transactions pattern) — currently a search miss shows the same empty
  copy. Replace the row skeleton with the reference table-row skeleton (or rely on the shared
  `DataTable` loading if adopted).
- **Stays:** the `EmptyState` icon (`CalendarClock`) and the create action.

---

## 3. Pending payments — `pending-payments.tsx`

### 3.1 Wrap in `Card`; keep amber as an accent — [Quick win → Larger]

- **Current (dated):** `pending-payments.tsx:27` is a bespoke panel: `overflow-hidden rounded-xl
  border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20` with a custom header row and
  `divide-y divide-amber-500/10` list. This is a hand-built colored panel, not a `Card`.
- **Reference:** §2.1 / checklist 4 — every container is a `Card` (`rounded-xl border bg-card
  shadow-sm`). Semantic emphasis comes from **accents** (an amber icon, an amber trend pill, an
  `AlertTriangle`), not a fully amber-tinted card. §3: amber = warnings.
- **Adopt:** render as a `Card`; keep the amber `AlertTriangle` (`h-4 w-4 text-amber-600
  dark:text-amber-400`) and the amber `Badge` on each pending row as the semantic accent, but drop
  the full `bg-amber-50/50` card fill in favor of neutral `bg-card`. If the owner wants the panel to
  still "pop", the on-map way is a `StatCard variant="amber"` header or an amber left-accent, not a
  tinted body.
- **[Ambiguous — owner]:** the amber-filled callout is deliberately loud (it is an action queue). If
  the owner values that prominence over strict card conformance, keep a **subtle** amber ring
  (`ring-1 ring-amber-500/20`) on a neutral `Card` as a compromise. Flagging rather than forcing.
- **Stays:** the confirm flow, `BrandIcon`, per-row amount (`tabular-nums`), due-date copy,
  `confirmingId` disabled state.

### 3.2 Confirm button → semantic accept color — [Quick win]

- **Current:** confirm is `<Button size="sm" variant="outline">` with a plain `Check`
  (`pending-payments.tsx:67-81`).
- **Reference:** §3 — emerald = "accept"/confirm; the `Check` icon is `text-emerald-500` in the
  reference (accept/reject pattern). Keep the button `outline`/`sm` but the accept semantics warrant
  an emerald `Check` (`text-emerald-500`) to match the accept convention. Minor.
- **Stays:** button size/variant, `confirming` label, disabled state.

---

## 4. Stats cards — `recurring-stats-cards.tsx`

Already the **most conformant** component — it uses `StatCard` with correct variants
(`blue` for burn, `violet`/`amber` for next payment). Minimal changes.

### 4.1 Grid breakpoints — [Quick win]

- **Current:** `grid gap-4 sm:grid-cols-2` (`:52`).
- **Reference:** §1.4 — the codified stat grids are `md:grid-cols-2 lg:grid-cols-4` (4 cards) or
  `md:grid-cols-3` (3 cards). Two cards on `sm:grid-cols-2` is close but off the codified breakpoint
  (the reference switches at `md`).
- **Adopt:** `grid gap-4 md:grid-cols-2` to match the reference breakpoint. **[Ambiguous — owner]:**
  the design language 4-up KPI row suggests there may be room for more than two KPIs here (e.g.
  active count, annual total) — but adding KPIs is **net-new** and out of scope. Keep two unless the
  owner explicitly wants to expand; if kept at two, just fix the breakpoint.
- **Stays:** both `StatCard`s, variants, `loading` pass-through, `subValue`/`description` usage.

### 4.2 Consider `trend` pill for overdue — [Ambiguous — owner]

- The "Next payment" card currently expresses overdue by flipping `variant` to `amber` (`:99-101`).
  `StatCard` also supports a `trend` pill (`intent: "negative"` → destructive) which is the reference
  way to show a negative/urgent delta. This is optional and a product-copy call — flagging, not
  prescribing. Keep the variant flip if preferred.

---

## 5. Projections — `recurring-projections.tsx`

### 5.1 Period toggle → `ToggleGroup` / reference segmented control — [Larger]

- **Current (dated):** `recurring-projections.tsx:91-109` hand-builds a segmented control:
  `flex gap-0.5 rounded-lg bg-muted p-0.5` wrapping ghost `Button`s that manually toggle
  `bg-background text-foreground shadow-sm` vs `text-muted-foreground`. This re-implements a toggle
  group by hand.
- **Reference:** §2.1 — "CardHeader `flex flex-row items-center justify-between` when the header has a
  title on the left and controls (**ToggleGroup** / picker) on the right." The reference control for
  mutually-exclusive period selection is `ToggleGroup`/`ToggleGroupItem` (used by the Wealth chart
  header), not a hand-rolled button row.
- **Adopt:** replace the manual button row with `ToggleGroup type="single"` +
  `ToggleGroupItem` for monthly/quarterly/annual, and lift it into a `CardHeader` with the
  "Projected spending" title on the left (the `TrendingUp` icon + label). Keep `Card` (already used)
  but use `CardHeader`/`CardContent` structure instead of stuffing everything in one `CardContent p-5`.
- **Stays:** all projection math (`toMonthlyEquivalent`, multiplier, `mostExpensive`), the
  `font-bold text-2xl tabular-nums tracking-tight` total (already on-scale), the per-period suffix,
  and the "most expensive" caption.

### 5.2 Card structure — [Quick win]

- **Current:** single `CardContent className="p-5"` holds header + value (`:83-129`).
- **Reference:** §2.1 — `CardHeader` (title/controls) + `CardContent` (body). `CardContent` default
  padding is `px-6`; compact panels use `px-5 py-4`. `p-5` is acceptable but prefer the header/content
  split above so the toggle sits in the header row like Wealth.

---

## 6. Calendar — `recurring-calendar.tsx`

### 6.1 Wrap in `Card`, not a bespoke bordered `div` — [Quick win → Larger]

- **Current (dated):** `recurring-calendar.tsx:110` is a custom `mx-auto flex w-full max-w-[320px]
  … rounded-xl border border-border/40 bg-transparent shadow-sm` container, with a hand-built
  "agenda footer" using `bg-secondary/5`, `border-border/50`, dotted leader lines
  (`border-dotted`), and `text-[10px]` micro-labels.
- **Reference:** §2.1 — chart/panel containers are `Card` (`rounded-xl border bg-card shadow-sm`);
  header row `CardHeader flex flex-row items-center justify-between` for title + controls. The
  `border-border/40` + `bg-transparent` are one-off values (the reference uses full-strength
  `border`/`bg-card`).
- **Adopt:** render the calendar in a `Card`; put the "Upcoming payments" / "Payments on {date}"
  title + the "Clear" button in a `CardHeader` (`flex flex-row items-center justify-between`), and the
  `Calendar` + agenda list in `CardContent`. Replace `border-border/40`, `bg-transparent`,
  `bg-secondary/5` with the standard `Card` surfaces.
- **Stays:** the `Calendar` component itself and its `classNames`/`modifiers` (the payment-dot dots
  are a legitimate custom affordance for this widget — the shadcn `Calendar` requires class overrides;
  keep them). The `isProjectedOnDate` logic, selected-date agenda, and `EmptyState` fallback stay.

### 6.2 Semantic labels & leaders — [Quick win]

- **Current:** the agenda header is `font-semibold text-[10px] text-muted-foreground tracking-wide`
  and the "Clear" affordance is a `text-[10px]` ghost button; rows use dotted-border leader lines
  (`:192`).
- **Reference:** §5.1 — micro-labels are `text-xs` (or `text-[10px]/[11px]`) often `uppercase
  tracking-wide` for section labels; that is on-map, so keep. The dotted leader line is a bespoke
  flourish not present in the reference — **[Ambiguous — owner]:** it is harmless and aids scanability;
  recommend keeping but noting it as a non-standard touch. The "Clear" control could become a
  `Button variant="ghost" size="sm"` for consistency with reference clear/reset affordances.

### 6.3 Loading skeleton — [Quick win]

- **Current:** custom pulse blocks with `bg-muted/30` / `bg-muted/40` (`:92-106`).
- **Reference:** §6 — use the `Skeleton` primitive (`animate-pulse rounded-md bg-accent`) mirroring
  the card layout. Swap the ad-hoc `animate-pulse … bg-muted/30` divs for `<Skeleton>` inside the same
  `Card` shell so the chrome stays visible during load.

---

## 7. History drawer — `recurring-history-drawer.tsx`

### 7.1 Use `ResponsiveDialog` (or confirm mobile behavior) — [Ambiguous — owner]

- **Current:** a right-side `Sheet` (`side="right"`, `md:max-w-[420px] lg:max-w-[480px]`)
  (`recurring-history-drawer.tsx:46-51`).
- **Reference:** §7 / checklist 13 — modals use **`ResponsiveDialog`** (desktop `Dialog`, mobile
  bottom `Sheet`/`Drawer`), and the actions/detail sheet is desktop-Dialog / mobile-Drawer. A
  right-side sheet on mobile can be cramped.
- **Adopt (recommended):** a right-side detail drawer is a defensible pattern for a scrollable
  history log and is close to the reference detail sheet. **[Ambiguous — owner]:** decide whether to
  (a) keep the right `Sheet` but ensure it becomes a **bottom** drawer on mobile (`useIsMobile()` →
  `side="bottom" max-h-[85dvh]`), or (b) migrate to `ResponsiveDialog`. Recommend (a) as the minimal,
  functionality-preserving change that satisfies §7's mobile convention.
- **Stays:** the `Sheet` header (title, frequency `Badge`, `CategoryChip`), loading `Skeleton`s
  (already using the primitive — good), error retry, and the expense list.

### 7.2 Summary tiles & empty state — [Quick win]

- **Current:** the totals summary is a `grid grid-cols-3 … rounded-lg border bg-muted/30`
  (`:125-149`) with `text-[10px]` labels; the empty state is a hand-built centered block
  (`:110-120`) with `Receipt` at `h-8 w-8 text-muted-foreground/40`.
- **Reference:** §4.5 — use the `EmptyState` component (icon in `bg-muted/50 p-3`, title `text-lg`,
  muted description) instead of the bespoke centered block. The summary tiles are fine as a compact
  `dl`-style stat row; §4.4 shows the reference details `dl` (`grid grid-cols-[auto_1fr] … text-sm`,
  amounts `tabular-nums`) — optionally align the summary to that, but the current 3-up tile row is a
  reasonable compact variant. Keep `tabular-nums` (present).
- **Adopt:** replace the empty block with `<EmptyState icon={Receipt} title={…} description={…} />`.
  Optionally normalize the summary labels from `text-[10px]` to `text-xs` (still on §5.1 scale).
- **Stays:** the summary math (total/count/average), the expense row list (`hover:bg-muted/40` rows —
  matches §5.3), currency formatting.

---

## 8. Loading route — `loading.tsx`

### 8.1 Mirror the real page shell — [Larger]

- **Current (dated):** `loading.tsx` wraps in `flex flex-1 flex-col gap-6 p-6` with a generic header
  strip, **2** stat skeleton cards using bespoke `flex flex-col gap-2 rounded-xl border p-4` blocks
  (`:13-21`), then 5 generic list-item rows with `rounded-full` avatars (`:24-43`). It does **not**
  reproduce the `SiteHeader` shell, the two-column layout, the pending-payments region, or the table.
- **Reference:** §6 / checklist 12 — the route loader "mirrors the real page layout": reproduce the
  header (title `h-8 w-48` + action `h-9 w-36`), then the page's **actual** grid/table. Grid pages
  replicate the exact grid; table pages use a header strip + N rows `flex items-center gap-4 border-b
  px-4 py-3`. Use the `Skeleton` primitive throughout.
- **Adopt:** rebuild `loading.tsx` to mirror the (post-refactor) layout — header action `h-8` (since
  the header action becomes `size="sm"`, per 1.1), the stat grid (`md:grid-cols-2`), and a **table**
  skeleton (header strip + rows) instead of the pill-list, plus a placeholder for the calendar/
  projections aside column. Keep the `skeleton-delayed-in` entrance (`:5`) — that is already the
  reference stagger.
- **Note:** the current loader's stat cards are `p-4` with three stacked lines — once stats use
  `StatCard` (`h-32`), the skeleton should be `h-32 rounded-xl border` to match, per §6.

### 8.2 Reconcile with in-component loading — [Quick win]

- The page already threads `loading={isLoading}` into `StatCard`/list/calendar/projections
  (in-component skeletons). §6 endorses in-component loading that "reuses the same shell". Keep both,
  but make sure the ad-hoc pulse blocks in list/calendar/projections use the `Skeleton` primitive
  (see 2.5, 6.3) so all loading affordances are consistent.

---

## 9. Dead code — `renewal-timeline.tsx`

- **Finding:** `RenewalTimeline` is **defined but never imported or rendered** anywhere in `src/`
  (grep confirms only self-references in the file). It duplicates functionality already covered by the
  calendar's agenda and the pending-payments queue.
- **Its own dated patterns (if it were revived):** bespoke `rounded-full px-2.5 py-0.5` date markers
  with `bg-muted/50`, hand-drawn timeline dots/lines, `text-[10px]` labels, and `bg-primary`
  today-markers — none routed through `Card`/`Badge`.
- **[Ambiguous — owner] — decision required:**
  - **(a) Delete it** — recommended if the calendar + pending queue already cover the "what's coming
    up" need. Removes a maintenance liability and an off-pattern component.
  - **(b) Wire it in and modernize** — only if the owner wants a horizontal 30-day renewal strip as a
    distinct feature. If so, it would need the same treatment as everything above (wrap items in
    `Card`, `Badge` for date markers, semantic colors, `tabular-nums`).
  - This plan does **not** assume either; it is a product call. Since it is unused, no styling work is
    warranted until the owner decides (a) vs (b).

---

## What stays the same across the whole page (do not touch)

- **All data/logic:** tRPC queries/mutations, `serverTime` timezone handling, `pendingTemplates`
  derivation, search/sort memoization, `toMonthlyEquivalent`, `isProjectedOnDate`, projection math,
  history aggregation.
- **All functionality:** create/edit via `useRecurringModal`, pause/resume, delete +
  `ConfirmationDialog`, confirm pending payment, view history, visit website, calendar date selection.
- **Already-modern primitives:** `SiteHeader`, `PageContent`, `StatCard` (stats), `ExpandableSearch`
  (`slashFocus`), `EmptyState` (list/calendar), `Sheet`/`ResponsiveDialog` family, `BrandIcon`,
  `CategoryChip`, `ConfirmationDialog`. These are reused as-is; the plan only relocates/rewraps around
  them.
- **i18n:** every `t(...)` key and the `next-intl` wiring stays; no copy changes are required by this
  plan (any new "Reset filters"/empty-variant copy in 2.5 reuses existing keys where available).

---

## Change list mapped to reference patterns (quick reference)

| # | Section | Change | Reference (design-language.md) | Size |
|---|---|---|---|---|
| 1.1 | page.tsx | Move "Add" into `SiteHeader.actions`, `size="sm"` + `Plus h-4 w-4` | §1.1, §5.4, checklist 9 | Quick |
| 1.2 | page.tsx | Drop `max-w-6xl`; flex+`280px` aside → 12-col 7/5 grid | §1.2, §1.4 (Wealth) | Ambiguous |
| 1.3 | page.tsx | `space-y-3` → `space-y-4` for list block | §1.3 | Quick |
| 2.1 | recurring-list | Hand-rolled `div` list → `DataTable` + `ui/table` columns | §4, checklist 6 | **Larger** |
| 2.2 | recurring-list | `MoreVertical`/`opacity-50` → `MoreHorizontal` `h-8 w-8 md:group-hover:opacity-100`; `renderContextMenu` | §4.2, §4.3 | Larger |
| 2.3 | recurring-list | Paused: keep `Badge`, reconsider full-row `opacity-50` | §5.5 | Ambiguous |
| 2.4 | use-recurring-status | `text-orange-500` → `text-amber-600 dark:text-amber-400` | §3 (amber=warning) | Quick |
| 2.5 | recurring-list | `EmptyState` into `DataTable emptyState`; no-match vs no-data + Reset | §4.5 | Quick |
| 3.1 | pending-payments | Bespoke amber panel → `Card` w/ amber accents | §2.1, §3, checklist 4 | Quick→Larger |
| 3.2 | pending-payments | Confirm `Check` → `text-emerald-500` (accept) | §3 | Quick |
| 4.1 | stats-cards | `sm:grid-cols-2` → `md:grid-cols-2` | §1.4 | Quick |
| 4.2 | stats-cards | Optional `trend` pill for overdue | §2.2 | Ambiguous |
| 5.1 | projections | Hand-built segmented toggle → `ToggleGroup` in `CardHeader` | §2.1 (Wealth header) | Larger |
| 5.2 | projections | Split into `CardHeader` + `CardContent` | §2.1 | Quick |
| 6.1 | calendar | Bespoke `border-border/40 bg-transparent` panel → `Card` | §2.1 | Quick→Larger |
| 6.2 | calendar | Normalize labels/leader lines; "Clear" → `ghost sm` | §5.1, §5.3 | Quick/Ambiguous |
| 6.3 | calendar | Ad-hoc pulses → `Skeleton` primitive | §6 | Quick |
| 7.1 | history-drawer | Right `Sheet` → bottom drawer on mobile (`useIsMobile`) / `ResponsiveDialog` | §7, checklist 13 | Ambiguous |
| 7.2 | history-drawer | Empty block → `EmptyState`; labels `text-[10px]`→`text-xs` | §4.5, §5.1 | Quick |
| 8.1 | loading.tsx | Rebuild to mirror real layout (header, stat grid, table skeleton, aside) | §6, checklist 12 | Larger |
| 8.2 | loading.tsx | Ensure in-component loaders use `Skeleton` primitive | §6 | Quick |
| 9 | renewal-timeline | Dead code — delete (recommended) or wire+modernize | n/a | Ambiguous |

---

_Plan only. No application code, component, or style is modified by this document. Implement against
`design-language.md` as the rubric; re-grade with the §8 Consistency Checklist when done._
