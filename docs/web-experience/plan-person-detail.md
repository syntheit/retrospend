# Person Detail — Modernization Plan

> **Scope:** Bring the **person DETAIL** page in line with the app's shipped design language
> (`docs/web-experience/design-language.md`). The people **LIST** page (`people/page.tsx`) was
> already modernized and is used here as an intra-app consistency reference alongside the four
> gold-standard pages.
>
> **Rules for whoever executes this:** reuse existing components/classes only. Do **not** invent
> new UI, do **not** redesign. Preserve every piece of functionality (data queries, filters,
> settle-up, reminders, exports, context menus, keyboard, navigation). Each item below cites the
> current dated pattern (file:line), the exact reference pattern to adopt, and what stays the
> same.

**Target files**
- Page: `src/app/(dashboard)/people/[type]/[id]/page.tsx`
- Timeline table: `src/components/people/people-timeline-table.tsx`
- Timeline columns: `src/components/people/people-timeline-columns.tsx`
- (No `[type]/[id]/loading.tsx` exists — see §7.)

**Reference sources used**
- Design language: `docs/web-experience/design-language.md`
- List page (already modern): `src/app/(dashboard)/people/page.tsx`
- Filter pattern: `src/app/(dashboard)/transactions/_components/filter-bar.tsx`
- Primitives: `src/components/ui/stat-card.tsx`, `src/components/ui/empty-state.tsx`,
  `src/components/ui/chip.tsx`, `src/components/ui/card.tsx`, `src/lib/constants.ts`
  (`getCategoryColorClasses`).

---

## Top divergences (executive summary)

1. **The whole page header/balance region is card-less and unstructured.** The person header,
   balance "hero", and action cluster are bare flex/grid `div`s (page.tsx L538–L1032), not
   `Card`/`StatCard`. Everything else in the app wraps content in `Card` (§2 / checklist #4).
2. **The balance "hero" is a hand-built colored text block, not a `StatCard`.** page.tsx
   L953–L1029. The shipped standard for a financial KPI tile is `StatCard` with a semantic
   `variant` (§2.2). The list page even ships a semantic balance card set for the same data.
3. **Bespoke pill/segmented toggles instead of shared primitives.** The status toggle
   (L807–L823, duplicated in table L460–L478), the project filter pills (L602–L798), and the
   filter-panel category/payer buttons are all hand-rolled. The app has `Chip`
   (`ui/chip.tsx`) and the list page's `SegmentedToggle` for exactly these.
4. **Dynamic Tailwind class `` `text-${cat.color}-500` `` (L440) is unsafe** — Tailwind can't
   see it at build time (no safelist config present), so category icon colors silently break.
   Must go through `getCategoryColorClasses` (§3).
5. **Two bespoke empty states instead of `EmptyState`.** The error state (L494–L513) and the
   "no shared expenses" block (L1096–L1112) are hand-built; the app mandates `EmptyState`
   (§4.5 / checklist #8). (The in-table empty state already uses `EmptyState` correctly.)
6. **Balance currency chips use `bg-white/10`** (L986, L1010) — a hard-coded translucent-white
   that is invisible in light mode. The list page's equivalent uses semantic
   `bg-emerald-50/bg-amber-50 border` tiers.
7. **Pending-settlement banner hard-codes `amber-200/amber-50`** (L1041) instead of the
   token-based `amber-500/20 bg-amber-500/5` the list page's verification banner uses (L516).

---

## Section 1 — Person header block

**Current:** page.tsx L551–L595. Avatar + name + stats + identity badge in a bare
`flex`/`sm:grid` layout. Name is `<h2 className="font-bold text-2xl">` (L562). Sub-lines are
`text-muted-foreground text-sm`. Sits directly on the page background with no container.

### 1.1 Wrap the header/summary region in a `Card` — *(larger)*
- **Adopt:** `Card` (`ui/card.tsx` = `rounded-xl border bg-card shadow-sm`), the same
  container every gold-standard section uses (design-language §2.1, checklist #4). Put the
  header (avatar/name/stats) and the balance/action cluster inside one `Card` with
  `CardContent`, so the top of the page reads as a structured summary card rather than loose
  text — mirroring how the list page frames its summary in `Card`s (list L426–L511).
- **Stays the same:** avatar (`UserAvatar size="xl"`), name text, `IdentityBadge`,
  username/email line, and the "sharing since · N expenses · N projects" stats line
  (L581–L593) — all keep their current copy, `tabular-nums`, and conditional logic.
- **Ambiguous (owner decides):** whether the header+balance become **one** card or the balance
  becomes its own `StatCard` (§2 below) beside a plain header card. Recommended: header in a
  plain `Card`, balance as a `StatCard` — matches §2.2's "prefer StatCard for a colored KPI
  tile." Flagged because it changes the L551 two-column grid.

### 1.2 Name typography — *(quick win)*
- **Current:** `font-bold text-2xl` (L562).
- **Adopt:** keep `font-bold text-2xl` — this already matches the design-language "entity name
  in card" scale (§5.1, "about/KPI value" = `font-bold text-2xl`). **No change needed**;
  listed only to confirm it is already compliant.

---

## Section 2 — Balance hero

**Current:** page.tsx L953–L1029. A `flex flex-col` text block: a muted label ("They owe you"),
then `font-semibold text-xl tabular-nums` colored emerald/rose, then per-currency chips. The
settled state (L955–L959) is emerald text + `CheckCircle2`.

### 2.1 Replace the hand-built KPI with `StatCard` — *(larger)*
- **Adopt:** `StatCard` (`ui/stat-card.tsx`, design-language §2.2). Map:
  - `title` = the direction label (`t("theyOweYou")` / `t("youOweThem")`, or "All settled up").
  - `value` = `formatCurrency(Math.abs(homeCurrencyTotal.amount), homeCurrency)`.
  - `icon` = a lucide glyph (e.g. `Scale` / `HandCoins`, both already imported in the codebase).
  - `variant` = **semantic per §3**: `emerald` when `they_owe_you`, `rose`/`amber` when
    `you_owe_them`, `neutral` when settled. (Owner: the list page uses **amber** for "payable";
    §3 lists rose for "negative/you-owe". Pick one and apply consistently — see §8 ambiguity A.)
  - `subValue` = the per-currency breakdown chips (below) when `balances` has >1 currency or
    conversion isn't possible.
- **KPI value class** becomes `StatCard`'s built-in `font-bold text-2xl tabular-nums
  tracking-tight` (currently only `text-xl`) — a deliberate, in-spec bump (§5.1 "KPI value").
- **Stays the same:** all balance math (`homeCurrencyTotal`, `netDirection`, `isSettled`,
  `balances`), the settled vs. owed branching, and the `canConvert` fallback that shows
  per-currency amounts without a total (L998–L1026) — this becomes the `subValue`/fallback
  content, unchanged in logic.

### 2.2 Fix the per-currency balance chips — *(quick win)*
- **Current:** L986 & L1010 use `border border-border bg-white/10 px-3 py-1.5` — `bg-white/10`
  is invisible on a light background.
- **Adopt:** the list page's tiered semantic chip (list L775–L800): a `rounded-full border` pill
  with `bg-emerald-50 border-emerald-200/60 dark:…` (they-owe) / `bg-amber-50
  border-amber-200/60 dark:…` (you-owe), amount `font-semibold text-sm tabular-nums` in the
  matching `text-emerald-700 / text-amber-700` (+ dark variants), currency code
  `text-[10px] text-muted-foreground`. Keep `CurrencyFlag` and `tabular-nums`.
- **Stays the same:** iteration over `balances`, `CurrencyFlag`, per-currency direction coloring
  logic (L1015–L1019) — only the container/token classes change.

---

## Section 3 — Action cluster (settle / remind / export)

**Current:** page.tsx L894–L952. A `flex flex-wrap` of buttons: settle (`Button size="sm"`,
L898), remind (`variant="outline"`, L903), and an export `DropdownMenu` (`variant="ghost"`,
L922). These are mostly already on-spec.

### 3.1 Keep as-is (already compliant) — *(no change)*
- Buttons already use `size="sm"` with leading `h-4 w-4` lucide icons and correct variants
  (design-language §5.4 / checklist #9). Export dropdown, remind cooldown, and settle label
  logic all stay.
- **Only relocation to consider (ambiguous, §8-C):** design-language §1.1 says page-level
  actions belong in `SiteHeader.actions`. Here the actions are balance-contextual (settle
  amount depends on direction) and are dense; moving them to the header is a **judgment call**,
  not a clear win. Recommend leaving them in the summary card. Flagged, not mandated.

---

## Section 4 — Project filter pills

**Current:** page.tsx L599–L799. Hand-rolled `<button>`s with a long `cn(...)` for
selected/unselected state (`border-primary bg-primary text-primary-foreground` vs
`border-border bg-secondary hover:bg-accent`), wrapped in `ContextMenu`s, each showing an image
/ `Layers` / colored dot + name + balance/`CheckCircle2`.

### 4.1 Base the pill styling on `Chip` conventions — *(larger)*
- **Adopt:** the `Chip` primitive's active/inactive convention (`ui/chip.tsx`): active =
  `bg-primary text-primary-foreground`, inactive = `bg-muted/60 text-muted-foreground
  hover:bg-muted hover:text-foreground`, base `rounded-full px-3 py-1 text-xs font-medium
  transition-all`. The current pills already use `rounded-full` + primary-active — align the
  inactive state and sizing to `Chip` so they match the list page's `SegmentedToggle` and the
  transaction filter chips.
- **Constraint:** `Chip` is a plain `<button>`, so it can stay wrapped in `ContextMenuTrigger
  asChild` exactly as today. Because these pills carry rich content (image/dot/balance) beyond a
  text label, adopting `Chip`'s **class convention** (not necessarily the component wholesale) is
  the pragmatic path — do not build a new pill component.
- **Stays the same:** all pill behavior — `selectedProjectId` toggling, ctrl/cmd-click to open
  project in new tab (L680), the per-project `ContextMenu` (open project / add expense / copy
  link / settle up, L747–L795), the "All" pill with aggregate balance, image/`Layers`/dot
  rendering, and the emerald/rose balance coloring (which already follows §3).

### 4.2 Overflow row — *(quick win, optional)*
- **Current:** `flex gap-2 overflow-x-auto pb-1` (L600). This is acceptable and horizontal
  scroll is intentional. **No change required**; noted so the executor doesn't "fix" it.

---

## Section 5 — Status toggle & filter panel

### 5.1 Status toggle ("All / Outstanding") — *(quick win)*
- **Current:** duplicated hand-built segmented control in page.tsx L807–L823 **and**
  people-timeline-table.tsx L460–L478 (`flex rounded-lg border p-0.5` + per-item `<button>`).
- **Adopt:** the list page's `SegmentedToggle` (people/page.tsx L53–L81) — a shipped, already-in-
  app segmented control (`rounded-full px-3 py-1 text-xs`, active `bg-primary
  text-primary-foreground`, inactive `bg-muted …`). Reuse it for both instances so the detail
  page's segmented controls match the list page's Sort/Activity toggles.
- **Stays the same:** the `all | active` state, `onStatusFilterChange`, labels
  (`t("all")` / `t("outstanding")`). Because the same markup is duplicated in the table
  component, updating both keeps them identical.
- **Ambiguous (§8-D):** `SegmentedToggle` currently lives inside `people/page.tsx`. Reusing it
  from the detail page means either importing it from there or lifting it to a shared file.
  Recommend lifting to `src/components/ui/segmented-toggle.tsx` (a mechanical move, no visual
  change). Flag for owner since it touches the list page's import.

### 5.2 Filter-panel category chips — dynamic-class **bug** — *(quick win, correctness)*
- **Current:** L425–L446. Category filter buttons color their icon with
  `` `text-${cat.color}-500` `` (**L440**) — a runtime-interpolated Tailwind class with no
  safelist, so these colors do not ship.
- **Adopt:** the reference filter-bar's category-chip approach
  (`transactions/_components/filter-bar.tsx` L120–L134 + design-language §3): resolve the icon
  via `getCategoryIcon(cat.name, cat.icon)` (already done, L426) and derive color classes from
  **`getCategoryColorClasses(cat.color, "accent" | "accentSelected")`**
  (`src/lib/constants.ts` L164) — static, safelisted variants built for exactly this chip. Never
  hardcode `text-<color>-500` at the call site (§3 rule).
- **Stays the same:** `toggleCategory`, `selectedCategories`, `aria-pressed`, `displayName`,
  the payer sub-filter (L450–L479), and the popover/drawer split (below).

### 5.3 Filter popover/drawer plumbing — *(no change, already compliant)*
- **Current:** desktop `Popover`, mobile bottom `Drawer` gated by `useIsMobile()`
  (L824–L881). This already matches design-language §7 ("filters in Popover→Drawer") and the
  reference filter-bar. **Keep as-is.** The `SlidersHorizontal` trigger with active-count badge
  is also on-spec (§7).

---

## Section 6 — Timeline table & columns

**Current:** `PeopleTimelineTable` already renders through the shared `DataTable` +
`ui/table` primitives, with `DataTableSelectionBar`, `renderContextMenu`, per-row `⋯`
(`h-7 w-7 md:opacity-0 md:group-hover:opacity-100`), `columnVisibility` for mobile, infinite
scroll, and `EmptyState`. **This component is largely on-spec** (checklist #6, #7, #8).

### 6.1 Keep the table architecture — *(no change)*
- `DataTable`, sticky glass header, `tabular-nums text-right` amounts (columns L266, L279),
  `CategoryChip` via `getCategoryColorClasses` (columns L204), `TransactionStatusBadge`,
  `AvatarStack`, keyboard/selection — all stay. Do **not** refactor this table.

### 6.2 Minor: the table's own status toggle — *(quick win)*
- The `statusToggle` in the table (L460–L478) is only used when `externalToolbar` is false; on
  the detail page `externalToolbar` is true (page.tsx L1078) so the **page** owns the toggle. If
  §5.1 lifts `SegmentedToggle` to shared, swap this internal duplicate too for consistency.
  **Stays the same:** the `countExtra` slot and `hideCount` behavior.

### 6.3 Settled-row styling — *(no change)*
- `rowClassName` returns `opacity-60` for settled rows (L380). This is consistent with the
  muted/settled semantic in §3. Keep.

---

## Section 7 — Empty & error states, loading

### 7.1 Error state → `EmptyState` — *(quick win)*
- **Current:** page.tsx L494–L513 — bespoke `flex h-64 … ` block with a muted `<p>` and a
  back button.
- **Adopt:** `EmptyState` (`ui/empty-state.tsx`, §4.5): `icon={UserX}` (or `Ghost`, already
  imported), `title={t("personNotFound")}`, `description={t("personCouldNotBeFound")}`, and an
  `action` linking back to `/people` (label `t("backToPeople")`). Keep it inside the same
  `SiteHeader` + `PageContent` shell (already present).
- **Stays the same:** `isError` gating, the `SiteHeader` title, and navigation target.

### 7.2 "No shared expenses" block → `EmptyState` — *(quick win)*
- **Current:** page.tsx L1096–L1112 — bespoke dashed-border block (`ReceiptText` +
  `<h3>` + `<p>` + optional public-profile button).
- **Adopt:** `EmptyState` with `icon={ReceiptText}`, `title={t("noSharedExpenses")}`,
  `description={t("noSharedExpensesDescription", { name })}`, and — when the person has a public
  profile — `action` (or `secondaryAction`) for "View public profile" linking `/u/{username}`.
  Wrap in the dashed container the in-table empty state uses if desired
  (`rounded-xl border border-dashed`, mirroring people-timeline-table.tsx L442).
- **Stays the same:** the `isLoading || hasHistory` gate, the public-profile conditional
  (L1103), and all copy.

### 7.3 Loading skeletons — *(ambiguous, owner decides — §8-B)*
- **Current:** in-component `isLoading` skeletons only (page.tsx L541–L549; table L427–L436).
  There is **no** `src/app/(dashboard)/people/[type]/[id]/loading.tsx`.
- **Design-language §6 / checklist #12** says routes ship a `loading.tsx` mirroring the layout —
  **but** it also explicitly blesses the Wealth pattern of in-component `isLoading` reusing the
  same shell. The detail page follows the Wealth pattern, so a route loader is **optional**.
- **If the owner wants one:** add a `loading.tsx` that reproduces the header card + balance
  `StatCard` + a few table skeleton rows, using `Skeleton` and the `skeleton-delayed-in`
  entrance (see people list `loading.tsx` for the pattern). Recommend deferring until §1–§2
  land, so the skeleton matches the new card layout. **Flagged, not mandated.**

---

## Section 8 — Pending-settlement banner

**Current:** page.tsx L1036–L1074. `rounded-lg border border-amber-200 bg-amber-50
dark:border-amber-800 dark:bg-amber-950/30` with `HandCoins`, message, and Confirm/Reject
buttons.

### 8.1 Align banner tokens with the list page's verification banner — *(quick win)*
- **Adopt:** the list page's banner container tokens (people/page.tsx L516):
  `rounded-lg border border-amber-500/20 bg-amber-500/5` — token-based amber that renders
  correctly in both themes — instead of the fixed `amber-200/amber-50` pair. Icon can sit in a
  `flex h-8 w-8 … rounded-full bg-amber-500/10` badge like the list banner (L520) for visual
  parity.
- **Stays the same:** the `pendingForMe` mapping, `confirmSettlement`/`rejectSettlement`
  mutations, Confirm (`CheckCircle2`) / Reject (`XCircle`, `variant="outline"`) buttons, and
  copy. Purely a token swap.

---

## Ambiguities to confirm before executing

- **A. Balance color for "you owe them": rose vs amber.** §3 maps negative/you-owe to **rose**;
  the modernized list page uses **amber** for "payable." The two pages should agree. Decide one
  and apply to §2.1 (`StatCard variant`), the currency chips (§2.2), and the project-pill
  balance text (§4). *Recommendation:* follow the list page (amber for payable) for intra-app
  consistency, or rose to follow §3 literally — owner's call.
- **B. Route `loading.tsx` (§7.3).** Add one, or keep the Wealth-style in-component skeletons?
- **C. Action placement (§3.1).** Keep settle/remind/export in the summary card, or move to
  `SiteHeader.actions` per §1.1? Recommend keeping in-card (balance-contextual).
- **D. Lift `SegmentedToggle` to a shared file (§5.1).** Needed to reuse it on the detail page
  without importing from the list route; mechanical move that touches `people/page.tsx`'s import.

---

## Change list at a glance

| # | Section | Change | Reference pattern | Size |
|---|---------|--------|-------------------|------|
| 1 | Header | Wrap header+summary in `Card` | `ui/card.tsx`; list summary cards | Larger |
| 2 | Balance | Replace text hero with `StatCard` (semantic variant) | `ui/stat-card.tsx` §2.2 | Larger |
| 3 | Balance | Currency chips `bg-white/10` → semantic `bg-emerald-50/bg-amber-50 border` tiers | list L775–L800 | Quick |
| 4 | Actions | Keep settle/remind/export as-is (already on-spec) | §5.4 | None |
| 5 | Project pills | Align pill classes to `Chip` active/inactive convention | `ui/chip.tsx` | Larger |
| 6 | Status toggle | Replace 2 hand-built toggles with `SegmentedToggle` | list L53–L81 | Quick |
| 7 | Filter chips | **Fix** `text-${color}-500` → `getCategoryColorClasses(color,"accent"/"accentSelected")` | filter-bar L120+; §3 | Quick (bug) |
| 8 | Filter plumbing | Keep Popover/Drawer split (already on-spec) | §7 | None |
| 9 | Table | Keep `DataTable` architecture untouched | §4 | None |
| 10 | Error state | Bespoke block → `EmptyState` | `ui/empty-state.tsx` §4.5 | Quick |
| 11 | Empty state | "No shared expenses" block → `EmptyState` | §4.5 | Quick |
| 12 | Loading | Optional `loading.tsx` mirroring new layout | §6; people `loading.tsx` | Ambiguous |
| 13 | Banner | `amber-200/50` → token `amber-500/20 bg-amber-500/5` | list L516 | Quick |

**Quick wins to land first:** #7 (correctness bug), #3, #6, #10, #11, #13.
**Larger, review carefully:** #1, #2, #5 (they restructure the L551 grid).
**Explicitly leave alone:** the `DataTable`/columns architecture, the Popover/Drawer filter
plumbing, infinite scroll, all mutations, context menus, exports, and keyboard behavior.
