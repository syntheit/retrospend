# Retrospend UI guideline

How to do each thing. Strict and simple. When this file and older code disagree, this file wins; when it is silent, ask the owner before you invent.

- **Sources:** the UI overhaul decision log (PLAN rules R1 to R31, tokens §4, glossary §7), the mockup kit (kit.css, COLOR.md, README) and the owner's notes (BRIEF N38 to N78). They live in `docs/ui-overhaul/` in the main checkout and are not committed; this file carries everything an agent needs.
- **Tags:** `[Rn]` is the PLAN rule a line comes from. `UI-0nn` IDs are in [CHECKLIST.md](CHECKLIST.md). Where today's app breaks a rule: [GAPS.md](GAPS.md).
- **Tokens:** [packages/tokens/src](../../packages/tokens/src) (DTCG JSON; `tokens.dark.json` holds the dark values) is the source of truth. `pnpm ui:tokens` generates `src/styles/tokens.css` and the native files in `packages/tokens/dist` from it.
- **Superseded:** `docs/design-system.md` and `docs/web-experience/design-language.md` described the old look (gradient hero cards, tinted stat cards). Do not follow them.

## 1. Principles

**Thesis:** calm when fine, clear when it needs you. Every fact has one home, every number one source, and every platform the same meaning.

1. Hierarchy comes from type, spacing and restraint, never from boxes, tints or decoration. [R2, R31]
2. A fact appears once per screen; anything else that refers to it links to it. [R4]
3. Color has one job per token. Meaning colors appear only where the meaning exists. [R6, R19]
4. The server computes every money figure; the client formats it. [R9]
5. Reuse a registered component or propose a new one. Never build a lookalike. [R18]
6. Every money action shows what it will change before it changes it, and can be undone after. [R30, R15]
7. Familiar on every platform: web, iPhone, iPad and Android share the meaning, the data visuals and the numbers; chrome and input are native to each.

**The tells we removed (do not bring them back):** tile rows; boxes standing in for hierarchy; the same fact repeated; color without a job; pill, button and control soup; UI that narrates itself; no type scale; hardcoded money and locale; phone screens that are reflowed desktop; accent stripes, sparkle icons, gradients, glows; ragged alignment. [PLAN §1, R31]

**Keep (the owner liked these; they are not tells):** the warm cream and brown identity with one teal accent; the sidebar in the page color, rounded, solid number typography (N38); category tiles inside list and table rows; underline tabs with a sliding indicator; status as dot plus word; plain menus, toasts and dialog shells; the People two-sided balance bar with faces ("colorful, whimsical", N57); the iPhone Home summary cards; the project cover (user photo or illustrated scene, N41); "What this changes" previews.

## 2. Tokens

Use Tailwind utilities that point at tokens. No raw hex, rgb, hsl or oklch outside `src/styles/tokens.css` and the legacy theme in `globals.css` (UI-001). No Tailwind palette colors such as `emerald-600`, `bg-white`, `text-black` (UI-002). No arbitrary values for color, size, spacing or radius.

### 2.1 Color: one job each

| Token | Tailwind | The one job |
|---|---|---|
| bg | `bg-bg` | Page background. The sidebar shares it |
| surface | `bg-surface` | Objects you act on: table, sheet, dialog, menu, input, phone list group |
| raised | `bg-raised` | Hover, selected row, segmented track, active nav row |
| line | `border-line` | Hairlines: row dividers, section rules, table header rule |
| line-strong | `border-line-strong` | Control and panel borders: input, secondary button, chip, sheet edge |
| fg | `text-fg` | Primary text, money |
| fg-2 | `text-fg-2` | Secondary text, labels, column headers |
| fg-3 | `text-fg-3` | Meta, placeholders, zero values |
| brand | `bg-brand`, `ring-brand` | Primary button fill, focus ring, selection, active nav. Nothing else |
| brand-fg | `text-brand-fg` | Text on brand |
| brand-soft | `bg-brand-soft` | Selected filter chip fill, text selection |
| accent | `bg-ds-accent`, `stroke-ds-accent` | Data and identity: chart line and area, progress on track, selected tab underline, group and avatar color |
| accent-strong | `text-accent-strong` | Accent as text: links |
| accent-soft | `bg-accent-soft` | Accent tint behind data |
| accent-fg | `text-accent-fg` | Text on an accent fill |
| positive | `text-positive` | Money coming to you: owed to you, income, funded. Text with a word, never a fill |
| attention | `bg-attention` | Needs you (dot, bar): overspent, underfunded, overdue, to review |
| attention-text, attention-bg | `text-attention-text`, `bg-attention-bg` | Attention as text; attention pill or notice background |
| info, info-bg | `text-info`, `bg-info-bg` | In progress: pending settlement, importing |
| danger, danger-fg, danger-bg | `bg-danger`, `text-danger`... | Destructive actions and errors only |
| owe | `text-owe` | You owe: plain text plus the words "you owe". Owing is not an alarm |
| scrim | `bg-scrim` | Backdrop behind a dialog or sheet |

- **The accent is `ds-accent` in Tailwind** until the switch-over, because the legacy shadcn theme owns `accent` (a hover gray). Never use `bg-accent` for the teal. [GAPS §3]
- Brand never carries money meaning. Accent is never a button fill and never a money color. Positive stays green, attention stays amber. [R6, R19]
- Ratio to aim for: warm neutrals about 70%, brand 10 to 15%, accent about 10%, meaning colors only where meaning exists. [R19]
- Status is a word plus a color, never color alone. [R5]
- Mix colors in oklab (`color-mix(in oklab, ...)`), never in oklch: tints turn brown or green.
- New code uses these tokens. The legacy shadcn tokens (`muted-foreground`, `card`, `accent`, `primary`...) stay only where code already uses them (UI-006).

### 2.2 Series, categories, avatars

| Set | Tokens | Rule |
|---|---|---|
| Series | `series-1` to `series-8` (hues 220, 50, 340, 125, 305, 15, 265, 175; series-1 is the accent) | Anything categorical that is not a category: chart series, account groups. Use in order. Never for categories |
| Categories | `category-1` to `category-21` | Mean only "which category". Charts of categories and category glyphs |
| Avatars | `avatar-1` to `avatar-8` (same hues, darker) | Initials background; white text passes 5.2:1 or better |

- Series have equal lightness, so under color blindness some pairs collapse. Label every series (legend, tooltip, initials). [COLOR.md]
- Account groups take series by size, largest first (the server sends the order). Liabilities stay neutral.
- A person's avatar color is the sum of the name's char codes mod 8, so it never changes.

### 2.3 Type

DM Sans for everything. JetBrains Mono only for strings you would paste (IDs, crypto addresses, invite codes). iOS chrome uses the system font.

| Role | Tailwind | Size / weight | Use |
|---|---|---|---|
| hero | `text-hero` | 32 / 600, tabular | One read-only hero number per page |
| title | `text-title` | 22 / 600 | Page title |
| section | `text-section` | 16 / 600 | Section heading, sheet and dialog title |
| body | `text-body` | 14 / 400 | Body, rows, controls |
| small | `text-small` | 13 / 400 | Secondary text, sublines, field labels |
| meta | `text-meta` | 12 / 400 | Meta, counts, hints. The floor |

- Nothing under 12px. No `text-lg`, `text-xl` and up, no `text-[Npx]` (UI-010). `text-xs`, `text-sm`, `text-base` map to 12, 14, 16 and are fine.
- Three weights: 400, 500 (labels, buttons), 600 (titles, money totals). No bold, black or light (UI-011).
- Sentence case everywhere. No uppercase tracked eyebrows; the sidebar group labels are the only exception (UI-012). [R12]
- Every number uses tabular, lining figures (`tabular-nums`).

### 2.4 Space, size, radius

| Thing | Value | Tailwind |
|---|---|---|
| Spacing scale | 4, 8, 12, 16, 24, 32, 48 | steps `1 2 3 4 6 8 12` (plus `0`, `px`, `0.5`) |
| Page gutter | 24 desktop, 16 phone | `px-gutter` |
| Header to toolbar, toolbar to content | 16 | `mb-4` |
| Section gap | 32 | `mt-8` |
| Section heading to content | 8 | `mb-2` |
| Control height | 32 desktop, 36 phone | `h-ctl` |
| Small control | 28, only next to other small controls | `h-ctl-sm` |
| Row height | 40 desktop, 44 phone | `h-row` |
| Money input | control + 8 (40 / 44), 16px medium | `h-money` |
| Trailing action column | 40 desktop, 56 phone web, 16 iOS | `w-trail`, `mr-trail` |
| Page max width | 1120 | |
| Sidebar | 232, same color as the page | |
| Radius | 8 controls, 12 panels and sheets, 999 chips and avatars | `rounded-ctl`, `rounded-panel`, `rounded-chip` (`rounded-lg`, `rounded-xl`, `rounded-full` are the same values) |

- Off-scale steps (`1.5`, `2.5`, `5`, `10`...) and arbitrary `p-[..]` fail UI-020. Arbitrary values that only wrap a token or the safe area (`px-(--gutter)`, `pb-[calc(1rem+env(safe-area-inset-bottom))]`) are fine.
- `rounded-sm`, `rounded-md`, bare `rounded`, `rounded-2xl` and up fail UI-021. A concentric inner radius (outer minus padding) is the one exception, and it lives inside a primitive.

### 2.5 Elevation

The UI is flat. Depth is a tone step (bg → surface → raised) plus a hairline.

| Token | Tailwind | Only for |
|---|---|---|
| shadow-menu | `shadow-menu` | Floating layers: menu, popover, dialog, sheet, toast |
| shadow-ctl | `shadow-ctl` | The selected segment of a segmented control |

No other shadows, no glows, no colored shadows, no `blur-*` blobs (UI-031). `backdrop-blur` belongs to glass chrome only. [R17]

### 2.6 Motion tokens

| Token | ms | Use |
|---|---|---|
| `--t-state` | 120 | Hover, press, color and border |
| `--t-menu` | 160 | Menus, popovers, dialogs |
| `--t-sheet` | 220 | Sheets and drawers |
| `--t-tab` | 220 | Tab indicator slide and pane change |
| `--t-row` | 200 | Row insert, remove, expand, collapse |
| `--t-num-in` / `--t-num-out` | 140 / 80 | A changed number sliding in and out |
| `ease-land` | cubic-bezier(0.22, 1, 0.36, 1) | Things arriving |
| `ease-leave` | cubic-bezier(0.4, 0, 1, 1) | Things leaving |

Write `duration-(--t-state) ease-land`, or `duration-120`. Any other duration fails UI-100. Rules in §11.

### 2.7 Icons

- lucide-react only (UI-034), 16px, stroke 1.75. One icon set, one size in rows and controls.
- No emoji in UI text (UI-035). No text glyphs as icons.
- No sparkles, magic wands or stars on actions (UI-033). The favorite star on currencies is the one star (it has a job).
- An icon earns its place by identifying something (category glyph, payment method, currency flag) or by being the whole label of an icon-only control. An icon next to a clear label usually adds nothing: drop it. [R31]
- Decided icons: Settle up and Settle all use `banknote`; confirming a payment uses `circle-check`; the exchange rate chip uses `arrow-right-left` (`repeat` means recurring); Release notes uses `file-text`.

## 3. Layout and page anatomy

### Every page [R1]
Header → Toolbar → Content. Nothing sits between the header and the toolbar.

| Part | Contains |
|---|---|
| Header | Title, at most one primary action, an overflow (⋯) menu. Optional faces of the people involved and one sub line. No tagline, no helper paragraph |
| Toolbar | Search (where a list needs it), filter chips plus a "Filter" menu, a view switch (Segmented) at the end. One row |
| Content | Flat sections (heading + content + space) or one list or table |

- **Sections are flat** [R2]: heading + content + space. A border goes only around an object you act on: a table, a sheet or dialog, a menu, an input, or a list group on phone. Never nest bordered things.
- **No tile rows** [R3]: at most one hero number per page. Other key numbers live in one glance line ("Spent ARS 2,706,602 · Left 59,161") or as key-value rows.
- **Page tabs** [R21]: underline tabs under the title move between sibling pages of one destination (Activity: Expenses, Recurring). They are part of the header.
- **Compact header on scroll**: once the title scrolls away, desktop shows a sticky bar with the cover thumb, the name, the primary action and the overflow.
- **Fill with meaning** [R26]: empty desktop space is answered with useful, glanceable content tied to the page's job (a rail with Needs you, Coming up, a balance), never decoration.
- **Density follows use** [R29]: a row shows only what a person acts on. Trends and secondary facts live on the detail page.

### Navigation (decided)
- **Desktop and iPad:** sidebar with the global Add (split button), a small search button that opens the Cmd+K palette, the six destinations (Home, Activity, Budget, People, Projects, Wealth), a Tools group (Import, Currencies), pinned projects (with their cover), and the account menu at the bottom (Settings, Admin, Invite codes, Feedback, Docs, Release notes, Sign out). Categories is a Settings section; export is in Settings, Data.
- **Phone:** the smart tab bar (Home, Activity, Budget, People, Projects) plus a separate + button. Wealth is reached from Home and search; Import from the Activity menu and the share sheet; Currencies from the Wealth menu and search. No global search: each list that needs one has its own field.
- **Breakpoints:** phone up to 767, tablet 768 to 1179, desktop 1180 and up. Check 1440, 1024, 768 and 390, light and dark.

## 4. Which component for which job

The registry is `src/components/ui/registry.ts`: every primitive with its one job and its status (core, internal, legacy). A new file in `src/components/ui` fails UI-040 until it is registered, and registering needs the owner's sign-off. Importing an internal or legacy primitive outside `src/components/ui` fails UI-041. Raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` outside the primitives fail UI-042.

| I need to... | Use | Not |
|---|---|---|
| Group content | A flat section: heading (`text-section`) + content + space | `Card` (legacy), a bordered box |
| Show a key number | One hero (`text-hero`) or a glance line or key-value rows | `StatCard` (legacy), tile rows |
| Narrow the rows I see | Filter chips (`Chip`) + a "Filter" menu | Tabs, buttons |
| Switch views of the same data in place | Segmented (`SegmentedToggle`), 2 to 4 options | Tabs, `ToggleGroup` (legacy) |
| Move between sibling pages or whole panes | Underline tabs (`Tabs`) | Segmented, chips |
| A task (add, edit, settle, assign) | Sheet (`ResponsiveDialog`): dialog on desktop, bottom sheet with detents on phone. One sheet per task | `Dialog`, `Drawer`, `Sheet` directly (internal) |
| Confirm a destructive action | `ConfirmationDialog` | `AlertDialog` directly (internal) |
| Actions on a row | ⋯ menu (`DropdownMenu`), right-click (`ContextMenu`), long press and swipe on phone: all from one action registry [R8] | A per-page menu list |
| Something needs the person now | A Needs you item, or one `Alert` notice (one line + one action), at most one per page | Stacked tinted banners |
| Confirm a finished action, offer Undo | Toast (`sonner`) | A notice |
| Nothing here | `EmptyState`: one line + at most one action | Prose, illustrations |
| Loading | `Skeleton` rows in place | A spinner page |
| Show a person | `UserAvatar`; a set of people: `AvatarStack` | Names only (unless the Names setting is on) |
| Show a category in a row | `CategoryBadge` (tinted tile allowed in rows only) | A tinted tile in a chip or menu |
| Show a status | A dot or pill plus a word from one status map (`Badge`, `TransactionStatusBadge`) [R5] | Color alone, ad hoc pills |
| Pick a date | `DatePicker` (with presets) | A native date input |
| Pick a rate type | `RateSelector` | A local select |
| Show money | The money formatter (§7) | `toFixed`, `toLocaleString`, a hand-built "$" string |

### The PLAN components

Every component of the overhaul plan (PLAN §6) is in the registry. These are built today: Table (`table`), Segmented (`segmented-toggle`), FilterChips (`chip`), Tabs (`tabs`), Sheet (`responsive-dialog`), DatePicker (`date-picker`), Chart (`chart`), EmptyState (`empty-state`), Notice (`alert`), Toast (`sonner`), Skeleton (`skeleton`), Sidebar (`sidebar`), Palette (`command`).

The rest are `planned` entries (`PLANNED` in `registry.ts`, with what each replaces). Build one only at its target, in its stream; until then use what the last column names, and never a local lookalike. [R18]

| Planned | Job | Target | Until it exists |
|---|---|---|---|
| PageHeader | Title, at most one primary, overflow; optional faces and one sub line | `src/components/layout/page-header.tsx` | The page's current header |
| Toolbar | Search, filter chips + Filter menu, view switch, one row | `src/components/layout/toolbar.tsx` | `Input`, `Chip`, `SegmentedToggle` in one `h-ctl` row |
| Section | Flat section: heading, content, space | `src/components/layout/section.tsx` | A `text-section` heading + content, never `Card` |
| SummaryLine | One glance line of key numbers | `src/components/layout/summary-line.tsx` | One `text-small` line, never `StatCard` |
| GlanceStrip | Home's hero number and glance line | `src/components/glance/glance-strip.tsx` | One `text-hero` number + a glance line |
| NeedsYouList, NeedsYouItem | Everything that needs the person, one style | `src/components/needs-you/*` | One `Alert` per page at most |
| TransactionRow | Expense, payment or transfer row | `src/components/rows/transaction-row.tsx` | The existing data-table rows |
| PersonRow, ProjectRow, AccountRow, EnvelopeRow | Entity rows (face, cover, group dot, progress) | `src/components/rows/*` | The current rows and tables |
| Money | One amount, and Money.pair (original, then home) | `src/components/money/money.tsx` | `useCurrencyFormatter()` |
| Balance, AvailablePill, StatusDot | Amount with its words; envelope money; dot plus word | `src/components/money/*` | The formatter plus words; `Badge` |
| ActionMenu, SwipeActions | ⋯, right-click, long press and swipe from one action registry | `src/components/actions/*` | `DropdownMenu`, `ContextMenu` |
| AddExpenseSheet, SettleSheet, AssignSheet | The money task sheets, with preview and Undo | `src/features/{entry,settle,budget/sheets}/*` | `expense-modal`, `settle-up-dialog`, the budget row edit |
| MoneyInput | Amount entry with grouping, locale parse, rate chip | `src/components/money/money-input.tsx` | `CurrencyAmountInput` |
| CategoryPicker, PersonPicker | One picker each, with identity | `src/components/pickers/*` | The form's existing picker (no new one) |
| BottomNav | Phone web tab bar plus a separate + | `src/components/shell/bottom-nav.tsx` | `Sidebar` (phone panel) |
| AccountMenu | The account menu at the sidebar bottom | `src/components/shell/account-menu.tsx` | `nav-user` |

### Buttons
| Tier | Style | Rule |
|---|---|---|
| Primary | brand fill, brand-fg text | The one action the screen exists for. At most one per header. Desktop Add is the split button "Add expense ▾" (Income, Transfer) |
| Secondary | surface fill, line-strong border | Other visible actions; row actions in a fixed-width right column |
| Ghost | no fill, fg-2 | Toolbar and icon actions |
| Danger | danger fill | Only the confirm button of a destructive dialog, last |

- One height per row: every control in a row is `h-ctl` (or all `h-ctl-sm`). [R31]
- Icon-only buttons have an `aria-label` and a tooltip (UI-131). No icon-only destructive button.
- Labels are verb first, sentence case, no trailing punctuation: "Add expense", "Settle up", "Save". A dialog's confirm repeats its verb ("Delete expense?" → Cancel, Delete expense).
- No icons on footer buttons ("Add and new", "Buy USD 300.00") unless the icon is the label. [R31]

## 5. Controls

| Control | Rule |
|---|---|
| Input | `h-ctl`, surface fill, line-strong border, 2px brand focus outline, danger border when invalid |
| Money input | `h-money`, 16px medium, groups thousands while typing, parses in the page locale. Never hero size inside an input [R22] |
| Select | No native browser chrome: our chevron, `h-ctl`, one fixed width per settings column |
| Chip | `h-ctl`, `rounded-chip`, line-strong border, text only. Selected: brand-soft fill + brand border. A chip that shows a value (a date range) is neutral with a chevron. People chips keep their face [R25 amended] |
| Segmented | raised track, 2px inset, selected segment surface + `shadow-ctl`, 8px radius, no icons, the same selected state for every option |
| Tabs | 40 high, 24 gap, fg-2 labels, selected fg 600 with a 2px accent indicator element that slides (§11). Counts in fg-3 |
| Switch | Settings that apply at once (autosave + toast) |
| Checkbox | brand when checked; the checkbox column is always present in a selectable list (disabled when a row cannot be selected) |
| Add more fields | Ghost text buttons with a plus ("+ Note", "+ Location"), no dashed borders |

- Never stack two controls of the same kind (two chip rows, two segmented rows). [R7]
- A control never looks like one kind and acts like another (a segmented control that navigates is a bug). [R21]
- Pickers and filter menus carry identity: a face, a project cover, a bare category glyph in its color (no tile), an account group dot. Every lead sits in one 24px slot so labels share one left edge. [R25]
- Menus with more than 10 items get type-to-filter (no keyboard pop on touch).

## 6. Tables and rows

- Desktop lists are tables; phone lists are rows in list groups. [R13]
- **Numbers align** [R27]: every money column right-aligns to one edge across group headers, rows and totals, with tabular figures. Group totals carry `mr-trail` so they sit on the row money edge. Rows in one group either all have the ⋯ column or none do.
- **One lead slot**: a row has at most one lead (category tile, face, cover, account tile), so titles start on one x.
- Fixed-width columns for identity (Project: cover + name, ellipsis at about 160px; With: faces + payer) so faces start on one edge.
- A row: title (body, fg), subline (small, fg-2: what and when), money right (body 500 or 600, fg or meaning color). No stacked "owes you" word inside a section already titled "Owe you". [R4]
- Payments, transfers, exchanges and balance updates render muted with a neutral tile and their kind word ("Payment · Pending", "Exchange"). None of them is spending.
- Selection, bulk bar, group headers with totals and the footer total come from the list primitive; footers say what they sum ("Your spending").
- Row height `h-row`. Hover (`bg-raised`) and right-click only on fine pointers. On phone: tap opens, long press opens the menu, iOS rows swipe (each swipe has a menu twin), phone web has no swipe (it clashes with browser back). [R13]

## 7. Money

**The server computes every money figure** (original, home, rate, rate date, totals). The client never converts, sums or rounds money; it formats what it gets. [R9] A missing exchange rate is an error, never 1.

**Every amount goes through one formatter** keyed on currency and the user's locale [R10]:
- Today: `useCurrencyFormatter()` (`src/hooks/use-currency-formatter.ts`) on the client, `formatCurrency` and `formatNumber` in `src/lib/currency-format.ts`. Dates: `src/lib/date-locale.ts`. `toFixed`, `toLocaleString` and `Intl.NumberFormat` belong only in `packages/domain` (the one formatter, after the move) and `src/server/services`; anywhere else, today's `src/lib` formatters included, they fail UI-070, as does date formatting outside the date helpers. Writing a symbol next to a value (`` `$${x}` ``, `` `${x} €` ``) fails UI-071. Arithmetic on money fields is banned in the same places but is review-only (UI-152).
- ISO minor units (JPY 0 decimals). Crypto up to 8 significant digits. Whole ARS shows no cents (smart formatting).
- Leading minus: "-ARS 2,000", never "ARS -2,000".
- A foreign amount always shows the ISO code ("BRL 51.90", "USD 2.99"). A symbol shows only for the home currency when it is unambiguous; every "$" currency shows its code ("ARS 1,234,567").
- The locale switch changes numbers and dates only. Copy stays US English.
- Tabular figures, right-aligned in lists. Money is never inside a pill.

**Multi-currency pairs:** a foreign amount shows the original first and the home amount second: "BRL 51.90" on the line, "ARS 13,407" muted below or after it. Totals are in the home currency and say how many rows had no rate ("2 without a rate").

**Rate types:** official, blue, card, MEP, market, custom. The default rate type is a per-home-currency preference (ARS home: Blue; Official where a currency has no Blue; Market for crypto), changeable in Settings and per currency. The rate chip (`arrow-right-left` icon) shows the type only when it is not the default; rate alternatives are labels only. Each account is valued at its own rate type, with dated switches.

**Signs and colors** [R5]: owed to you is positive with the words; you owe is plain fg (`owe`) with the words "you owe"; settled is fg-3. Owed to you and You owe are two lines, never netted into one figure. [D1]

**States** [R14]: every number specifies zero (fg-3, "Settled", "Nothing yet"), missing rate ("No rate yet", left out of totals and counted), extreme (7+ digit ARS, 0.004 ETH: no truncation, no wrapping), loading (skeleton the width of the number) and unavailable.

**Money actions** [R30, R15]: every action that changes money (add, edit, delete, settle, confirm, assign, move, transfer, update a balance, close an account) previews exactly what it will change before Save: "What this changes" as label and before → after rows for what moves, then one closing sentence for what does not ("Nothing else changes: your accounts and net worth"). After Save, an Undo toast. Optimistic UI only for safe, reversible actions. Accounts move only on deliberate money moves you link to an account; a normal expense never touches accounts. [N75]

**Amount inputs** [R22]: normal height (`h-money`), medium weight. The hero size (32) is for read-only totals only.

## 8. People and faces

- Wherever a set of people appears (project rows and header, split, people list, expense rows with a split), show faces: `AvatarStack` overlaps, spreads on hover with one tooltip per face (name, Paid, share) and ends with +N. Setting: Profile pictures (default) or Names. [R20]
- People on Retrospend show their picture; others show initials on their avatar color. "Not on Retrospend" is a status word in the subline, not a dashed ring.
- Sizes: xs 22, sm 24, default 32, md 40, lg 48.
- Payer first in a split stack. One avatar per person per row.
- People list (Direction A): an overall line, Waiting on you, then person rows by balance. The two-sided balance bar with faces stays.
- A person's page: the balance once (expand per currency), Settle up, a Project filter chip on the ledger, per-project balances as label-value rows.

## 9. Charts and the series palette

- One question per chart, named in its title. Labels 12px, colors from tokens only (`var(--series-n)`, `var(--ds-accent)`), drawn at the measured width.
- Single series: accent. Several: series in order, every series labeled (legend, tooltip). Categories use category colors, and only in charts of categories.
- Ranked lists of categories: bars in one accent fill, the category glyph carries identity. No rainbow, no stacked 100% bar that repeats a ranked list.
- Attention (amber) only for over budget; positive only for money in.
- Chart kinds: pace line (spent vs plan), monthly bars, ranked bars, net worth area, allocation bar (one 100% bar + legend rows). Hover shows a tooltip with date and value; gaps are null, never zero.
- Charts look the same on every platform: the native apps draw the same chart kinds from the same tokens and numbers.

## 10. Sheets, dialogs and menus by platform

| Platform | Sheet | Menu |
|---|---|---|
| Desktop web | Centered dialog, `rounded-panel`, `shadow-menu`, scrim; Esc closes; focus trapped and returned | ⋯ menu and right-click from the action registry; keyboard letters follow menu hints |
| Phone web | Bottom sheet with medium and large detents and a grabber; toasts move to the top while a sheet is open; the floating Add never covers the last row | ⋯ button and long press |
| iOS (Expo) | Native sheet with detents (`.medium`, `.large`), glass at partial detents only; no dismiss or critical gesture near the top edge | Native context menu (long press) + swipe actions with a menu twin |
| Android (Expo) | Material 3 modal bottom sheet | Material menu + long press |

- One sheet or page per task. [R8] Add expense and Add income are separate sheets; Transfer is its own sheet. [N71]
- Sheet anatomy: title (section, text only, no colored icon), fields on one grid, "What this changes", footer with Cancel and the specific verb. No accent stripe or colored top border, ever. [R31]
- Enter submits a one-field sheet, Cmd or Ctrl+Enter submits any sheet. A closing sheet ignores Save (no double save).

## 11. Motion [R24]

- Motion is part of the design: underline tabs slide their indicator and move content on a shared horizontal axis (direction follows tab order), 220ms `ease-land`. Sheets, list inserts and removals, and changing numbers animate too.
- Only state changes animate. Nothing animates on page load for decoration; no looping animation except spinners and skeletons.
- No bounce or overshoot, ever, and especially not on money (UI-101). Numbers slide their digits (80 out, 140 in); never count up money.
- A removed row collapses (200) and its Undo toast brings it back.
- Sibling pages may use a cross-document View Transition where supported.
- Reduced motion: opacity only. `tokens.css` drops movement durations to 1ms (UI-102); components must not move things when `prefers-reduced-motion` is set.

## 12. Empty, loading and error states [R14]

| State | Pattern |
|---|---|
| Empty | One line + at most one action: "No expenses yet" [Add expense] |
| Filtered empty | "No matches" + [Clear filters] |
| Loading | Skeleton rows in place, the shape of the content |
| Error | "Couldn't load expenses" + the server message muted + [Retry] |
| Toast success | Object + past participle: "Expense added", "Payment recorded" + Undo |
| Toast failure | "Couldn't save the expense" |
| Not mocked or not supported | Say so. Never "Saved" when nothing changed |

**Fresh shared surfaces** [R16]: balances, verifications and Needs you are shared between people, so they refresh after their own mutations and on a push or a poll, never only on reload. One dependency graph declares which mutation invalidates which surface; a new mutation adds its edges there instead of refreshing by hand (UI-111).

## 13. Wording and glossary [R11]

- US English, sentence case, one short sentence at most. Show a rule in the interface instead of explaining it.
- No em dashes anywhere in UI copy, code strings or message catalogs (UI-120). Use a comma, colon, period or parentheses.
- A missing value is a short muted word ("None", "No rate yet", "Not set"), never a dash glyph.
- Copy lives in `packages/i18n/messages` (next-intl). English is the source; every locale follows the same rules. New keys go in a feature file, `messages/<locale>/<feature>.json`, which becomes the `<feature>` namespace; add it for every locale. Literal English in JSX (a text child, or a `placeholder`, `title`, `aria-label`, `alt` or `label` prop) fails UI-124: render it with `t()`.

| Use | Not |
|---|---|
| Expense (a row), Activity (the page) | transaction (except in import and bank wording) |
| Person; "Not on Retrospend" as a status | contact, participant, member, guest, ghost, shadow profile |
| Project | group (except "a project groups shared expenses") |
| Settle up (verb); Payment (the record) | square up, pay off, record payment |
| Owes you / You owe; Owed to you | receivable, payable, debt |
| Recurring expense | subscription, bill, template |
| Net worth (the number); Wealth (the page) | portfolio |
| Sign in / Sign out | log in, log out, login |
| Delete (destructive), Remove (take out of a list) | mixing the two |
| Add income (its own sheet) | income inside Add expense |
| Not planned yet (budget money with no job; "To assign" only in the Every peso style) | To assign everywhere |
| Left to spend (everyday spending envelopes only) | a total that mixes bills in |
| Cash and cards, not in Wealth yet / Cash you received, not in an account (Not tracked) | unlogged, untracked balance |

UI-121 enforces the clear-cut rows (log in, participant, shadow profile, square up, pay off, receivable, payable, portfolio). The rest is review.

## 14. Accessibility floor

| Item | Floor |
|---|---|
| Text tokens on bg, surface and raised | 4.5:1 or better, both themes (UI-004 checks every pair) |
| Text on a fill (brand, accent, danger, avatar) | 4.5:1 |
| Graphics (accent, series) on bg | 3:1 |
| Status | Never color alone: a word is always present |
| Focus | 2px brand outline with offset, visible on every control. Never remove an outline without a focus-visible replacement (UI-130) |
| Names | Every input and icon-only button has an accessible name (UI-131) |
| Targets | 24px minimum on desktop web; 44pt on touch (iOS), 48dp on Android |
| Keyboard | Everything reachable; `/` focuses search, Cmd+K palette, Esc closes the top layer, Enter on a row opens it; sheets trap and return focus |
| Motion | Reduced motion honored (§11) |

Known exceptions: light-theme attention (amber dot) is 2.1:1 on bg and category colors are 2.9:1 at worst, so they always come with a word or a glyph; see GAPS §4.

## 15. iOS and Android notes (Expo app)

The native apps share the meaning, the numbers, the data visuals, the color jobs and the glossary with the web. Chrome, sheets, pickers and gestures are native. "Familiar, not the same."

- **Tokens:** import `light` and `dark` from `@retrospend/tokens/theme` (colors as hex, since React Native has no oklch; sizes in dp; durations in ms). Other clients read the flat `packages/tokens/dist/tokens.json`. Do not copy values by hand.
- **iOS** [R17, R28]: follow the HIG. Liquid Glass only on chrome (tab bar, navigation bar buttons, the bottom accessory, toolbars, sheets at partial detents), never on rows, charts or numbers. Primary input sits in the thumb zone. Tab roots get the large title; pushed pages get an inline title and a back button labeled with the parent. The account button trails the large title on Home. At most two trailing nav bar buttons (primary and overflow). The + beside the tab bar is a separate button, never a tab: it opens a plain personal expense in the home currency, or the screen's own context; long press offers Add expense and Add income. The accessory is a context pill (an active trip, drafts, a settlement in flight) and is absent when there is no context. Search is per list, pulled down under the title (searchable). Dynamic Type and system font in chrome.
- **Android:** Material 3 equivalents: navigation bar for the five tabs, a FAB for Add, modal bottom sheets, Material menus, 48dp targets, the system back gesture.
- **Both:** rows are lists, never tables; swipe actions each have a menu twin; haptics and system morph transitions are native; reduced motion and larger text are honored; widgets later (WidgetKit, Glance).
- **Tablet:** sidebar-adaptable tab view defaulting to the sidebar with all six destinations, list-detail for Activity, People and Projects, keyboard shortcuts and pointer hover. Mockups come first (queued).

## 16. Decided defaults

Build these; do not build the alternates.

| Question | Decision |
|---|---|
| Second hue | Teal-blue accent, h 220 (N51) |
| "You owe" color | Plain text (option A) |
| People display | Profile pictures by default; Names is a setting (R20) |
| Phone navigation | Smart tab bar: Home, Activity, Budget, People, Projects + a separate + (N50, N65) |
| Global search | Desktop Cmd+K palette; phones search inside each list (N65) |
| Sidebar | Six destinations + Tools (Import, Currencies); Categories inside Settings (N46 to N48) |
| Desktop Add | Split button "Add expense ▾" with Add income and Transfer; keys N, I, T (§14) |
| Income | Its own Add income sheet (N71) |
| Pick-one control | Segmented in place; underline tabs between sibling pages (R21) |
| Category identity | Tinted tile in rows; bare colored glyph in menus and pickers; chips text only (R25 amended by R31) |
| Default rate type | Per home currency; ARS home → Blue (N73) |
| Owed to you / You owe | Two lines, never netted (D1) |
| Budget | Flex style by default; Left to spend = everyday spending only; "Not planned yet" replaces To assign except in Every peso (N72, N77) |
| Accounts | Move only on deliberate money moves linked to an account (N75) |
| Money actions | Preview what changes and what doesn't (R30) + Undo toast (R15) |
| People page | Direction A; keep the two-sided balance bar with faces (N57) |
| Project cover | Content: the user's photo or the illustrated scene (N41) |
| Settle up icon | `banknote` (N66) |
| Compact header | Sticky bar with thumb, name, primary, overflow once the title scrolls away (N67) |

## 17. The Never list

| Never | Tell it prevents |
|---|---|
| A bordered card around a section; cards in cards | Boxes for hierarchy [R2] |
| A tile row of numbers; more than one hero number | Tile rows [R3] |
| A gradient, glow, decorative blob or blur | Decoration [R31] |
| A colored accent stripe or top or side border on a sheet, card or banner | "The stupid bar at the top with the colors" [R31] |
| Sparkle, magic wand or stars icons on actions | AI-slop icons [R31] |
| An icon that adds nothing next to a clear label; a colored icon before a sheet title | Icon soup [R31] |
| A tinted icon tile inside a chip or picker | Color without a job [R25, R31] |
| Dashed pills, dashed rings, dotted underlines on values | Stitched look [R31] |
| Raw colors, palette colors, off-scale sizes, spacing or radii | No system [R6, R12] |
| Uppercase tracked eyebrows | No type scale [R12] |
| Two stacked chip, tab or segmented rows; a segmented control that navigates | Control soup [R7, R21] |
| The same fact twice on one screen | Repeated fact [R4] |
| Narrating paragraphs, taglines, "Every check is passing" | UI that narrates itself [R11] |
| Em dashes | Owner rule [R11] |
| `toFixed`, `toLocaleString`, client-side money math, a hand-built "$" | Hardcoded money and locale [R9, R10] |
| Hero-size numbers inside inputs | [R22] |
| A redesigned form that drops a field or toggle | Feature regressions [R23] |
| A money action without a preview or without Undo | Unintended side effects [R30, R15] |
| Bounce, overshoot or count-up on money | [R24] |
| Controls in one row with different heights; money columns off one edge | Poor alignment [R27, R31] |
| Phone screens that are reflowed desktop; hover-only affordances on touch | [R13] |
| Glass on rows, charts or numbers | [R17] |
| A new primitive, token, color or icon style without owner sign-off | Drift [R18] |

## 18. The ratchet

`src/test/uiRules` runs every [auto] item of the checklist over `src` and `packages/i18n/messages` in `pnpm check`. Today's violations are recorded per rule and file in `baseline.json`.

- **Above the baseline fails** with file and line: fix the code.
- **Below the baseline only warns.** Run `pnpm ui:ratchet` to lower it and commit the result with the fix. A merge that fixes something on two branches never turns main red; the review gate (IMPLEMENTATION §6.3) runs `pnpm ui:ratchet` after each merge into a segment or main and commits the tighter baseline.
- **Moved a file?** `pnpm ui:ratchet --rename <old> <new>` carries its counts and `allow.json` entries over (folders: end both paths with `/`).
- **Raising is guarded.** The test compares `baseline.json` and `allow.json` with their copies at the merge base with main. A higher count or a new allow entry fails unless a commit message on the branch has the line `ui-ratchet-raise: <reason>` (a new rule, a rule fix that finds old violations, a move git does not see as a rename). Renames git detects carry their counts along. Without git or a merge base (a shallow clone) the check is skipped with a warning, so CI checks out the full history.
- Never edit this file or the checklist to make a check pass.

## 19. Switch-over

Today's app still runs on the legacy shadcn theme in `globals.css`. The design tokens sit alongside it, so nothing changed visually. The order to move pages onto them, and what changes when the legacy theme goes, is in [GAPS.md](GAPS.md) §3.
