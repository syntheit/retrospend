# UI gaps

Where today's app breaks the rules in [GUIDELINE.md](GUIDELINE.md), so the ratchet baseline (`src/test/uiRules/baseline.json`) makes sense. Numbers are from the rulebook branch on main at 1431b28, with every rule through UI-151. Regenerate the tables with `pnpm ui:ratchet --report`.

The baseline is a ceiling, not a to-do list: no rule and file may go above it, and every fix lowers it (`pnpm ui:ratchet`). Pages are rebuilt in the UI overhaul, not patched one class at a time; the counts mostly fall as whole pages move to the new components.

## 1. Counts by rule

| Rule | Hits | Files | What |
|---|---|---|---|
| UI-001 | 144 | 17 | Raw color literal |
| UI-002 | 1071 | 93 | Tailwind palette color (emerald-600, blue-500, white, black) |
| UI-010 | 422 | 127 | Font size off the type scale or under 12px |
| UI-011 | 215 | 74 | Font weight outside 400/500/600 |
| UI-012 | 64 | 36 | Uppercase or letter-spaced label (eyebrow) |
| UI-020 | 553 | 139 | Spacing off the 4/8/12/16/24/32/48 scale |
| UI-021 | 169 | 83 | Radius off the tokens |
| UI-030 | 17 | 12 | Gradient |
| UI-031 | 107 | 70 | Glow, decorative shadow or blur |
| UI-032 | 4 | 4 | Accent stripe |
| UI-033 | 2 | 2 | Sparkle icon (`releases-header.tsx`, `nav-user.tsx`) |
| UI-034 | 4 | 4 | Second icon set (tabler in the sidebar files) |
| UI-041 | 104 | 95 | Import of a legacy or internal primitive (Card 66, Dialog 14, StatCard 6, ToggleGroup 5, Drawer 4, Sheet 4, AlertDialog 4, Calendar 1) |
| UI-042 | 63 | 37 | Raw button, input, select, textarea or table |
| UI-070 | 92 | 47 | Number, money or date formatted by hand (now everywhere but `src/server/services`, so today's `src/lib` formatters and some routers count) |
| UI-071 | 17 | 7 | Money string built by hand |
| UI-100 | 35 | 28 | Duration off the motion tokens (mostly 300 and 500) |
| UI-101 | 1 | 1 | Overshoot easing (`settle-pop-in` in `globals.css`) |
| UI-120 | 41 | 13 | Em dash in UI text (32 of them in `messages/*.json`) |
| UI-121 | 79 | 11 | Glossary word (55 in `messages/en.json`: participant, login, shadow profile, square up...) |
| UI-124 | 1048 | 107 | Literal English in JSX (824 in the site and docs pages, 208 in the app) |
| UI-130 | 29 | 19 | Outline removed without a focus-visible replacement (22 in primitives) |
| UI-131 | 25 | 14 | Icon-only button without an accessible name |
| UI-150 | 32775 lines over | 95 | File over its size limit (largest: `routers/project.ts` 2167 over, `projects/[id]/page.tsx` 1357, `settlement.service.ts` 1286) |
| UI-151 | 13 | 13 | `~/server/db` in a transport file (`trpc.ts`, 9 routers, 3 API routes) |
| **Total** | **4319** | **294** | UI-150 is in lines and not in the total |

## 2. Where they are

| Area | Hits | Biggest rules |
|---|---|---|
| App pages and components (`src/app` minus site and api, `src/components` minus ui, `src/hooks`) | 1799 | palette colors 606, spacing 256, literal English 208, font sizes 176 |
| Site: landing, docs, public profile and pay pages (`src/app/(site)`) | 1758 | literal English 824, spacing 251, font sizes 230, weights 166 |
| `src/lib` | 366 | palette 284 and raw colors 59, almost all in the category color map |
| Primitives (`src/components/ui`) | 279 | radius 58, palette 56, spacing 46, shadows 37, outline 22 |
| Message catalogs (`messages/*.json`) | 87 | glossary 55, em dashes 32 |
| Server (`src/server`, `src/app/api`) | 22 | database in transport 13, formatting 9 |
| Styles (`src/styles/globals.css`) | 8 | glass header and stripes literals, gradient, overshoot, 300ms |

Top offenders (UI-150 left out):

| File | Hits | Rules |
|---|---|---|
| src/lib/constants.ts | 326 | UI-001 42, UI-002 284 |
| src/app/(site)/docs/self-hosting/page.tsx | 88 | UI-010 7, UI-011 6, UI-020 15, UI-021 7, UI-042 1, UI-124 52 |
| src/components/budget/budget-header.tsx | 84 | UI-002 50, UI-010 14, UI-011 4, UI-012 5, UI-020 2, UI-021 2, UI-030 2, UI-031 4, UI-041 1 |
| src/app/(site)/releases/_releases/v0-4-0.tsx | 82 | UI-010 1, UI-020 3, UI-121 6, UI-124 72 |
| src/app/(site)/docs/features/projects/page.tsx | 79 | UI-010 10, UI-011 9, UI-020 10, UI-120 2, UI-121 8, UI-124 40 |
| src/app/(dashboard)/people/[type]/[id]/page.tsx | 67 | UI-002 32, UI-010 8, UI-011 3, UI-012 2, UI-020 18, UI-041 1, UI-042 2, UI-070 1 |
| src/app/(site)/docs/configuration/email/page.tsx | 67 | UI-010 8, UI-011 7, UI-020 12, UI-021 1, UI-042 1, UI-121 1, UI-124 37 |
| src/app/(site)/docs/features/recurring/page.tsx | 67 | UI-010 10, UI-011 7, UI-020 8, UI-041 1, UI-124 41 |
| src/app/(site)/docs/features/shared-expenses/page.tsx | 67 | UI-010 11, UI-011 10, UI-020 10, UI-041 1, UI-121 1, UI-124 34 |
| src/app/(site)/docs/configuration/storage/page.tsx | 66 | UI-010 9, UI-011 8, UI-020 14, UI-021 3, UI-041 1, UI-042 1, UI-124 30 |
| src/app/(dashboard)/projects/page.tsx | 64 | UI-002 38, UI-010 2, UI-011 1, UI-020 6, UI-021 4, UI-030 2, UI-031 4, UI-041 1, UI-042 3, UI-070 1, UI-100 2 |
| messages/en.json | 59 | UI-120 4, UI-121 55 |
| src/app/(site)/docs/configuration/ai-import/page.tsx | 57 | UI-010 9, UI-011 8, UI-020 11, UI-041 1, UI-042 1, UI-124 27 |
| src/app/(dashboard)/_components/recent-expenses.tsx | 55 | UI-002 46, UI-010 2, UI-020 2, UI-021 2, UI-031 1, UI-041 1, UI-042 1 |
| src/app/(site)/docs/features/multi-currency/page.tsx | 52 | UI-010 8, UI-011 6, UI-020 6, UI-041 1, UI-124 31 |

### Allowed exceptions (`src/test/uiRules/allow.json`)
UI-001 only: the Open Graph image files (satori has no CSS variables), third-party brand colors (payment apps, the Matrix link) and the Recharts attribute selectors in `ui/chart.tsx`. Nothing else is exempt.

## 3. Switch-over: from the legacy theme to the design tokens

The design tokens (`src/styles/tokens.css`, generated from `packages/tokens/src`) are loaded next to the legacy shadcn theme in `globals.css`. They add variables and utilities (`bg-surface`, `text-fg-2`, `h-ctl`, `rounded-panel`, `shadow-menu`, `text-title`...) and change nothing on screen. Today the app uses the legacy color utilities about 2,500 times in 235 files.

Changing the legacy values in place would restyle every page at once (the dark theme is neutral gray today, the design's dark theme is warm; `muted-foreground`, `border` and `card` differ from `fg-3`, `line` and `surface`). So the switch happens page by page:

1. **Primitives first.** Rebuild `src/components/ui` on the design tokens (button, input, select, chip, segmented, tabs, sheet, menus, table). This clears most of UI-021, UI-031 and UI-130 in one place and gives pages the right controls.
2. **Pages, one at a time,** as each overhaul page is built: new components, design tokens only, the baseline lowered in the same branch.
3. **Rename the accent.** Replace the remaining `bg-accent` / `text-accent-foreground` hover uses (119 in 37 files, mostly primitives) with `bg-raised` / `text-fg`, then drop the `cssName` of `color.accent` in `packages/tokens/src/tokens.json` and regenerate.
4. **Remove the legacy theme** from `globals.css` (the `:root` and `.dark` blocks, `--chart-*`, `--sidebar-*`, the glass header) once nothing references it. Promote UI-006 to [auto] at that point.

Values that change for people when a page switches (expected, decided):
- **Dark theme** turns from neutral gray (chroma 0) to the warm dark of the design.
- **Avatar colors:** today 10 Tailwind 700 hexes (`ui/user-avatar.tsx`, name hash mod 10); the design has 8 avatar tokens (mod 8), so some people get a new color once. Do it in one change, not page by page.
- **Category colors:** today Tailwind palette classes in `src/lib/constants.ts`; the design has 21 `category-n` tokens. Map them once (stored category color names → token numbers).
- **Money format:** today `formatCurrency` shows symbols ("AR$1,234,567", "R$51.90"). The design shows the ISO code for foreign and every "$" currency ("ARS 1,234,567", "BRL 51.90"). This is a formatter change in `src/lib/currency-format.ts`, with its tests, before pages adopt the new money display. The new formatter is `formatMoney` in `@retrospend/domain/format` (golden cases in `packages/domain/vectors/`); call sites move to it in S1 and S4.
- **Currency decimals:** `decimal_digits` in `packages/domain/src/currencies.ts` disagrees with ISO 4217 for 20 codes, all 0 in the table: AFN, ALL, AMD, COP, CRC, HUF, IDR, IRR, LBP, MGA, MMK, MUR, PKR, RSD, SOS, SYP, TZS, UZS, YER (ISO 2) and IQD (ISO 3). Only the old `formatCurrency` reads it, so today's display shows them whole; stored money and the new formatter use ISO (`currencyDecimals` in `money.ts`). Leave the table as it is until `formatCurrency` is retired, then delete the field rather than fix it.
- **Charts:** `src/lib/chart-theme.ts` and the chart components use hex colors; move them to `var(--series-n)` and `var(--category-n)`.

## 4. Findings in the design itself

- **Light attention (amber) is 2.1:1 on bg,** below the 3:1 graphics floor. The amber dot and bar always come with a word ("Overspent"), so meaning never rests on it, but an amber progress bar alone would fail. Kept as the kit has it; flag for the owner if amber needs to stand alone.
- **Category colors reach 2.9:1 at worst in light** (graphics floor 3:1). Categories always come with a name or glyph.
- **Every text token passes 4.5:1** on bg, surface and raised in both themes (UI-004 checks 100 pairs); series pass 3:1; avatar initials pass 5.2:1.

## 5. Not enforced automatically

These are review items because a scan cannot judge them reliably: layout order and tile rows (UI-050, UI-051), the same fact twice (UI-052), alignment of money edges and control heights (UI-022, UI-060), whether an icon adds nothing (UI-036), color doing its one job (UI-005), legacy token use in new code (UI-006, until the switch-over), money math on the client (UI-072), previews and Undo on money actions (UI-075), faces and identity in pickers (UI-080, UI-081), motion quality (UI-103), states (UI-110) and most of the glossary (UI-123). Money arithmetic on the client (`a.amount + b.amount`, `* rate`, rounding a total) is banned outside `packages/domain` and `src/server/services` (IMPLEMENTATION §4), but a scan cannot tell a money field from a count, so it stays review-only (UI-152, with UI-072). Known blind spots of the scan itself are listed at the top of `src/test/uiRules/rules.ts` (implicit 150ms on `transition`, date-fns `format`, a currency symbol held in a variable, class lists split across literals).

## 6. Superseded docs

`docs/design-system.md` (gradient hero cards, tinted semantic cards, decorative circles) and `docs/web-experience/design-language.md` (codified the pre-overhaul pages, including StatCard and `duration-300`) now point here. Their old text is in git history.

## 7. Missing data sources (TODO)

Parts of the new UI that wait for a server source. Each one is left out or shown as not available, never filled with made-up data.

| Where | What is missing | Until then | Owner |
|---|---|---|---|
| Shell palette (`src/components/shell/palette.tsx`) | Typed results for people, projects, accounts, categories and expenses (RC14): one search read model that matches accent-insensitively | Typing filters Go to and Commands only | S2 search + S1c part 2 |
| Shell palette | The inline currency converter ("100 usd", "50000 ars to brl") with every rate type | No converter row; Currencies is in Go to | S1c part 2 (rates read from the server) |
| Shell palette | Suggestions from Needs you (imports to review, the person you owe most, the next recurring item due) | No Suggestions group | 2E `needsYou()` |
| Shell palette, Recent | A recent-items read model (people and projects you opened, expenses) with Money DTOs | Recent shows the two most recently updated active projects and the last three expenses from `expense.listFinalized`, whose amounts arrive as numbers and are turned into minor units by `toMinor` | S2 |
| Shell nav badges (`src/lib/nav.ts` `NavBadges`) | Needs you counts per destination (Activity: imports to review; People; Budget) | `AppShell` takes `badges` as an optional prop; no badge shows | 2E |
| Sidebar pinned projects | A pin per person and project | The Pinned group lists active projects, most recently updated first, at most 5 (the kit's fallback) | S4F projects |
| Sidebar pinned projects | A light read of names and covers | The sidebar reuses `project.list({ status: "ACTIVE" })`, which also computes balances | S2 |
| Add income, Transfer (split Add menu, palette, I and T keys) | Their sheets (4G) | Shown disabled with "Coming soon"; the keys show a "coming soon" toast | S4G |
| New routes (`/home`, `/activity`, `/activity/recurring`, `/activity/insights`) | The pages | `SHIPPED_ROUTES` in `src/lib/nav.ts` is empty, so the new shell links today's routes; Insights is hidden. Each page agent adds its route there when it ships | S4 |
| Phone account entry on today's pages | The new PageHeader with the account avatar | Today's SiteHeader menu button opens the account sheet in the new shell (`LegacyMenuBridge` in `app-shell.tsx`); the button is hidden on desktop | S4 pages |
| Verify your email (today's sidebar banner) | Its mockup home is a Home Needs you item | A single attention Notice at the top of the content in the new shell (`verify-email-notice.tsx`) | 2E + S4 Home |
| Public profile (`/u/{username}`) | Done in Settings v2: Profile > Public profile has Copy link and View. Today's page keeps its links in Payment methods | Settings v2 only (uiV2) | S4H settings (done) |
| Settings > Developer, token scopes | A server path that sets an API key's scopes (`POST /api/v1/tokens`): the api-key plugin only lets the server set `permissions` | New keys are read-only. The sheet lists every scope and shows the write ones disabled with "Not available yet"; `createToken` in `src/features/settings/developer/tokens.ts` already takes scopes, so the route swaps in there | S3 platform |
| Settings > Preferences, Default rate type | The per-user default rate type (M2, `UserSettings`) on this branch | Row left out | 2A.2, then S4H |
| Settings > Security, backup codes | A read of the current backup codes with which are used (the mockup's struck-through codes); better-auth keeps them encrypted and only exposes `viewBackupCodes` server side | Codes show once, when made; the Backup codes sheet makes a new set with the password | S3 platform |
| Settings > Security, Turn off two-factor | Turning off with a 6-digit code or a backup code (mockup); better-auth `twoFactor.disable` takes the password | Turn off asks for the password | S3 platform |
| Settings > Profile, pending email | A Resend for the pending email confirmation (mockup); `profile.update` needs the password again | The Notice offers Cancel change only | S4H follow-up |
| Settings > Categories, Count in spending | A category-level "not counted in spending" that every total respects (mockup R6). Today `excludeByDefault` only makes new expenses in the category start excluded | The row says "New expenses left out of totals" and the menu toggles exactly that | 2E |
| Settings > Data, row counts | Entry and account counts for the export rows ("CSV, all 665 entries") from one read each | Rows say only the format | S2 |
| Settings > Payment methods, drag to reorder | The desktop drag handle (mockup); not built in v2 yet | Move up, Move down and Make primary in the row menu | S4H follow-up |
| Category colors (GAPS §3) | Stored colors replaced by `category-n` tokens in the data | `src/lib/category-tone.ts` maps each stored name to the nearest-hue token, one place for every page | S4 |
| Settings > Profile, Remove photo | Undo for a removed photo (GUIDELINE §11: a removed thing comes back from its toast). The upload route deletes the stored file, so there is nothing to bring back | Remove asks first with a named button (Remove photo) instead of offering Undo | S4H follow-up (keep the old file until the toast is gone) |
| Sidebar group label letter spacing | A tracking token for the one eyebrow the guideline allows | `tracking-wider` on the sidebar's Tools and Pinned labels (allow.json UI-012) | S0a tokens |
| Activity Compare, and totals for narrowed filters (`src/features/activity`) | A spent() read for the period before; spent() filters by person, project, payer, type and text | Turning Compare on says it is not available yet. The footer and the phone day totals come from `spent(filter)` (`expense-list/totals.ts`) for dates and categories only; a person, project, payer, type or search filter shows no total rather than a different one | 2A |
| Activity rows without a rate | A count of the filter's rows with no rate (the footer's "N without a rate") | Rows show "No rate yet" on their own. When the home rate itself is missing, the footer and day totals are left out (never counted at 1) | 2A (spent with a missing count) |
| Activity Type filter: For someone else; editing money in, refunds and transfers | Reimbursements (2D); the Add income and transfer sheets (4G) | Spending, Money in, Refunds and Not spending list their rows (M1 direction and entry kind; starting balances and adjustments never show). Reimbursements return no rows. Money in, refund and transfer rows do not open today's expense form and offer only Delete | 2D, 4G |
| Activity To review chip, Review mode, This import chip | Import review state on rows (`reviewed`, batch) | Not shown; every row reads as reviewed | S4B part 2 (Import) |
| Activity bulk selection (Categorize, Move to project, Mark reviewed, Export CSV, Delete) | TransactionTable keeps its selection inside; it needs `onSelectionChange` and the bulk bar | The table renders with `selectable={false}` | S1 kit |
| Activity layout A on desktop (day group rows in the table) | TransactionTable group rows with a day total | Desktop keeps the Date column; phones are grouped by day | S1 kit |
| Activity row actions | Accept split, Reject split, Make recurring expense, Copy as text are not in the expense registry; Change category and Move to project need a pick-from-menu pattern; Open waits for the entry read view (4G); delete has no restore endpoint for Undo | The menu offers Edit, Duplicate and Delete (with its named confirm) | S1 kit + 4G |
| Activity Export CSV of the filtered rows | An export by filter (today's export takes ids) | Not in the header menu | S4B part 2 |
| Activity project covers on rows | Project cover in listV2 rows | Flat tile | S4E covers |
| Recurring Confirm sheet (another amount, paid on, use this amount from now on, Skip this time), Skip, and Confirm Undo | `recurring.*` changes (confirm with amount and date, skip, and an unconfirm that deletes the booked row and steps the template back in one transaction) (2E) | Confirm (row button, menu, phone tap) opens a confirm step that names the amount, the date and the next due date, then books the template amount; no Undo. A template whose amount varies (Ask) has no Confirm here. Skip has no handler, so it is not shown | 2E + S4B |
| Recurring View history, Visit website, Add recurring income | History and website are not in the recurring registry; income templates need direction IN (M1) | Not offered | S1 kit, 2A |
| Recurring biweekly in RecurringRow | `RecurringVM.frequency` has no biweekly and rows lack the auto-pay line | Phone rows are composed from the Row anatomy with the feature's own words | S1 kit |
| Figure ids of rows and recurring costs | `entry.amount:<row>`, `entry.share:<row>`, `recurring.amount:<id>`, `recurring.cost.<dir>.<period>` are not in the figures registry or `/api/v1/figures` | The flows audit them against the tRPC reads (`expense.listV2`, `recurring.listView`) | S2 figures + S3 |
| Shared expense faces for a participant who did not create it | RLS on `split_participant` shows a participant only their own row of a standalone shared expense | listV2 adds the payer to the faces and the Person filter matches the payer too; other participants stay hidden | S2 (RLS helper `is_split_participant` in the policy) |
| Saves elsewhere refreshing Activity | `settlement.*` and `recurring.confirmAndCreate` do not list `expense` in `src/lib/query-invalidation.ts` | Payment rows refresh on the next visit; the Recurring tab invalidates listV2 itself after Confirm | shared map owner |
| Recurring delete Undo | A restore for a deleted recurring template | Delete asks first with the template's name (registry confirm); the toast has no Undo. Pause, Resume and Auto-pay do have Undo | 2E |
| Recurring add and edit sheet | The one Recurring expense sheet (next due a month out, More details for pay from and website) | Today's modal ("New subscription", 8 fields, next due today, auto-pay on) opens from the header, the empty state and Edit | S4G Add family |
| Recurring header overflow menu (Add recurring income) | The Recurring expense sheet with money in (4G); income templates exist since M1 | The header has no overflow menu; only Add recurring expense | S4G Add family |
| Recurring "Logged this month" by auto-pay only | A marker on rows booked by auto-pay (the sidecar and a Confirm both write `pricingSource` RECURRING) | The section lists every row booked from a template this month, under "Logged this month" | 2E |
| Rate type on Activity rows, shown | A visible rate chip slot in TransactionRow and TransactionTable (GUIDELINE §7 "rate chip"); the kit only has `TransactionVM.rateTip`, a tooltip on the amount pair | A foreign row booked at a type other than the default carries it in the amount's tooltip ("Official rate") | S1 kit |
| Table panel look on `ui/table` | `TABLE_LOOK` draws the panel hairline through `[&>div>div]`, the DataTable structure; `ui/table` wraps the table in one div and keeps its glass header class | The Recurring table adds `border border-line` next to `TABLE_LOOK`, as Currencies does; the header cells take `bg-surface` from `TABLE_LOOK` | S1 kit |
| Wealth and Currencies: figure ids | `netWorth`, `netWorthChange`, account and rate figures in the figures registry, so `/api/v1/figures` can serve them | The pages render every amount through `Money` with `data-minor` and `data-currency` but tag no `data-figure`; the e2e flows skip the figure audit for them and `required-figures.ts` lists none | 2D |
| Wealth: Money DTOs | `wealth.getDashboard` / `getRunwayStats` return float major units | `src/features/wealth/server/` converts them to Money once, on the server, with the domain's `toMinor`, and sums groups and shares in integer minor units; 2D deletes that adapter when its read models return Money | 2D |
| Wealth: account legs, transfers, `inBudget`, Not tracked | The middle-option accounts (N75) | Left out: no Not tracked line, no transfer rows, no "in budget" marker | 2D |
| Wealth: net worth change breakdown | `netWorthChange(30).breakdown` (income, spending, revaluation, exchange, not logged) | The 30-day change shows as text, not as a link to the breakdown sheet | 2D |
| Wealth: rate type history per account | Dated revaluations (D3) and a rate type per account in the pair (a USD account valued at ARS official or blue) | The rate type chips show only when the account's own currency has several types (what `updateAssetBalance` honors today); a USD account is valued at the home currency's best type | 2D |
| Wealth: previews | `preview()` for update balance, edit, add, close, reopen, delete | No "What this changes" block in the sheets; every write still ends with Undo (delete has a named confirm and no undo) | 2D |
| Wealth: Owed to you / You owe groups | `owed()` per person (`owed.owedToYou`, `owed.youOwe`) on this branch | Left out of the list and of the assets by group bar | 2E (money-engine) |
| Wealth: runway at the plan's cost | `planCost()` from the budget engine | Runway reads "at your average spending of X a month" from today's `getRunwayStats` | 2B |
| Wealth: View history | A per-account balance history read (`AssetHistory`) | The menu item has no handler, so it is hidden; closed rows do not open | 2D |
| Wealth: Add income here | The Add income sheet | The menu item has no handler, so it is hidden | 4G |
| Wealth: liability terms on edit | Minimum payment and due day in the dashboard read | Asked when adding a liability; an edit leaves them as they are | 2D |
| Wealth: "All" range | History older than a year | Ranges are 1M, 3M, 6M and 1Y | 2D |
| Wealth: account row sub line | A kit slot in `AccountRow` (`src/components/rows/account-row.tsx`) for the sub line's leading parts: the currency code, "Valued at Blue", a liability's APR, and "No CLP rate. Left out of net worth." (for example `AccountVM.meta: string[]` placed before the date) | Rows show only "Updated {date}"; a missing rate shows "No rate yet" in the money column and the header counts it. The page does not fork the row | S1 (kit) |
| Currencies: default rate type per currency | `rateOptions` / `defaultRateType` / `setDefaultRateType` (money-engine `src/server/services/rate-types.ts`) | `src/features/currencies/server/rate-default-seam.ts` returns the built-in default (blue, then official) and `CAN_SET_DEFAULT = false`, so the page shows the default without a picker and the header has no Default rate menu | 2A.2 merge |
| Currencies: custom rate for a missing currency | A mutation to save a typed rate | The missing-rate row and notice name the accounts left out; no Save rate field | 2D |
| Currencies: USD as a favorite | Favorites are exchange rate rows; USD is the table's base and has none | The USD star is disabled with a tip | 2A.2 (rate prefs) |
| Currencies: prices under one minor unit | A rate formatter (significant digits, or the price of 1,000 units) | With a USD home, 1 ARS reads 0.00 | domain |
| People: totals with a currency that has no rate | `owed()` that sums the people with a rate and names the rest (the mockup's striped stub), instead of null for everyone | When any balance currency has no rate, Owed to you and You owe read "No rate yet" and the bar is left out; the page names the currencies. Each row still shows its own amounts | 2C/2E (payments figures) |
| People: per-person figure ids | A `data-figure` id that carries a person (`balance.person` needs `personId`), so the audit can read row, Person and Settle up numbers back | Only `owed.owedToYou` and `owed.youOwe` are tagged; the Person page and the sheet render through `Money` with `data-minor` and `data-currency` and no id | S3 figures contract + S6 audit |
| People: approximate marks | A way for `Money` to say a converted figure is about (the mockup's "≈") | Converted nets show without the mark; the Person page names the rate under each currency | S1 (kit) |
| People: row currency parts | A `PersonRow` slot for the native parts under the net (`ARS 802,352 · BRL 402.50`), a pending state ("Pending · you paid ARS X") and a hover Settle up | Rows show the net; the parts are on the Person page; pending is said in the subline; Settle up is in the row menu and the S key | S1 (kit) |
| People: Needs you leads with the face | `NeedsYouItem` with a face lead and a second action (Not received) | The kit's icon tile and one action (Confirm, Review) | S1 (kit) |
| People: balance bar segment jump | `BalanceBar` segments as buttons that scroll to the person's row | Segments carry a tooltip only | S1 (kit) |
| People: Export settlements (CSV) | An export of every person's payments | Not in the header overflow; the Person page exports its own history, plan and statement | S2 export |
| People: Remind someone not on Retrospend | The pay link message sheet (mockup) | The page says the reminder is yours to send; Copy invite link is in the Person overflow | S4 follow-up |
| People: Add expense with someone | The Add expense sheet taking a person (4G) | "Add expense with X" opens the empty Add expense sheet | 4G |
| People: accept a split from Review | A preview and an Undo for accepting a split (it adds your share to your spending) | Review shows the title, your share and the date; Accept and Reject end with a plain toast | 2E + 4G |
| Person: entry read view, Ask to fix, Correct, bulk delete | The entry read view and its actions (4G) | Your own unsettled rows open today's edit form; others' rows do not open; no selection | 4G |
| Person: balance chart | A balance series read | Payments list in its place (as the mockup) | 2C |
| Person: all rows | Paging for Between you | The newest 200 shared expenses and every payment; the footer counts them all | S4 follow-up |
| Settle up: From / Into account | An account leg on `payment.record` (N75 middle option) | No account field; the preview checks only the balances it touches | 2D |
| Settle up: accounts and net worth in "What this changes" | `netWorth` and account figures in the registry, so the preview checks them | The sheet lists what the server checked (your balance with them, Owed to you, You owe) | 2D |
| Settle up: switching currency keeps the amount | A conversion read for a typed amount | Switching currency empties the amount; Everything and the parts refill in the new currency | 2C |
| People: unseen changes dot | A `PersonRow` lead with the attention dot on the face | The subline says "2 new" | S1 (kit) |
| People: 390 row subline | `RowSub` keeping a status (Not on Retrospend) whole when it comes last; today the last part is the one that shrinks | The status can cut to "Not"; the Person page says it in full | S1 (kit) |
| People: 390 balance bar ends | `BalanceBar` keeping a face over the last segment inside the bar | A small You owe segment's face can sit past the edge | S1 (kit) |
| Person: rate date (RC5) | The quote's date in `loadQuotes` | Each currency names its rate type and value, not its date | 2C |
| Person: Between you table and Filter menu | A ledger table with a Between you column and the Filter menu (category, project) | Rows on desktop too, with Paid by, faces, date, total and the effect; chips and project rows filter | S1 (kit) |
| People pages: page container and back button | A kit `PageFrame` and a back button (Button asChild on a link) | The People, Person, Wealth and Currencies pages share `src/features/wealth/page-frame.tsx` | S1 (kit) |
| People: one balance read | `listPeople` without its own float balance batch | The overview reads balances three times: today's `listPeople` (identities and last shared), its own minor-unit batch, and `owed()` (the registry's numbers, so Home and Wealth match) | 2E (people read model) |
| Budget side of money moves (`transfers/budget-side.ts`) | `WealthTransfer` (M8): a transfer that crosses the budget line, and a Move in, have no To assign or envelope to move yet | `recordBudgetSide` writes nothing and says `no_envelope_budget`; `transfer.create` and `income.moveIn` still return the effect they computed (leaves, enters, counted and the amount), so previews can show it. Income kept in Wealth stays out of To assign (`budgetMoneyInWhere`), so a Move in counts it only once this lands | 2B P4 |
| Income's booked value (`income/add.mutation.ts`) | The stored home rate on the row (M2, 2A.2) and a custom rate | The booked value is read from the rate table at the chosen rate type and stored on the income's leg; an income with no account stores none. `income.add` takes rate types only, no typed rate | 2A.2, then 2D |
| Net worth change, Owed part (`accounts/net-worth-change.ts`) | A history of balances with people | `netWorthChange.*` holds Owed to you and You owe at today's value (as the Wealth chart does), so a payment or a split moves no part; `netWorth` itself includes them today | 2C |
| Paying someone back from an account | `payment.record` takes no account | Payments move no account; net worth moves by Owed only | 2C |
| Today's Wealth dashboard (`wealth.getDashboard`) | The page reading the figures | It keeps its own float valuation; it adds legs and dated rate type switches to its history, but a USD account's rate type (D3) values the home side only in the figures | S4 Wealth |
| Editing an income or a transfer fee from Activity (`expense.updateExpense`) | An income edit mutation that rewrites the row's leg | Amount, currency and date edits on a row with a leg are refused (delete it and add it again); title, category and notes stay editable | 2D follow-up |

## 8. Behavior gaps found by the e2e suite

- **Clicks before hydration do nothing (S4).** Buttons rendered on the server (Add Expense, New Project, the user menu) ignore a click that lands before React hydrates; the user has to click again, and nothing says the page is not ready yet. The e2e suite waits for `html[data-hydrated="true"]` (`src/components/hydration-marker.tsx`) before it clicks. The v2 pages should either work without JavaScript for their primary action or show it as not ready until hydration.
- **Profile form labels point nowhere (S4).** Fixed in Settings v2 (`src/features/settings/profile/name-fields.tsx`: each label points at its input). In today's `src/components/settings/profile-section.tsx` the labels use `htmlFor="name"` (and `username`, `email`) while `FormControl` gives each input a generated id, so screen readers announce the fields without their labels. The e2e spec selects the name field by `input[name="name"]` until the form is rebuilt.

## 9. Data the server does not have yet

- **Per-user time zone.** Server-side calendar days (project membership dates, which expenses fall before someone joined) come from `userTimeZone()` in `src/server/services/user-time-zone.ts`, which returns `DEFAULT_TIME_ZONE` or Buenos Aires for everyone. When a per-user zone setting exists, that function reads it; no call site changes. The M5 backfill used the same default.
- **Writers that skip the booked home value (M2, 2A.2).** The expense form, recurring confirm and amortized parts store `rateType`, `homeCurrency`, `homeRate` and `homeAmount`. These writers still leave the home leg empty, so their rows follow the totals rule (the period's rate) and drift with later rates:
  - the sidecar's recurring auto-post (`sidecar/tasks/recurring.go`, raw INSERT): 2A sidecar follow-up, book the home leg like `bookRate` (same rate type default, cross rate to 12 decimals, home amount half-even from the exact rate);
  - CSV import (`src/server/services/csv.service.ts`) and the import queue (`src/server/services/import-queue.service.ts`): 2E.4 import, call `bookRate` per row;
  - shares of shared expenses (`getSharedExpenseShares`): no home leg on `SharedTransaction` yet (2C).
- **Envelope valuation ignores the booked value (I20, 2B).** `src/server/services/envelope/valuation.ts` reads `ownRate: { to, perUnit }` but its loader does not fill it from `expense.homeCurrency` and `expense.homeRate`, and nothing reads `homeAmount`. Until it does, budget books value every row at the book rate type. Fix: when `homeCurrency` is the book currency, use `homeAmount` as the row's value (it is already rounded to that currency's minor units).
- **Rate type picker and default rate type have no endpoint yet (2A.2).** The service exists (`src/server/services/rate-types.ts`: `rateOptions`, `defaultRateType`, `setDefaultRateType`) and `createExpense`/`updateExpense` accept `rateType` and `customRate`, but the expense router's input schema and the settings router do not pass them. The Add sheet (S4) and Settings need them wired.
- **Card rate for ARS.** ADD-EXPENSE-R2 shows Official, Blue, Card and MEP; the rate source has official, blue, mep and crypto for ARS, so the strip offers what the table has and no Card. Owner question.

## 10. Push delivery (M12)

Registration (`src/server/services/push-device.service.ts`) is built; the sender is not. What the sender must do:

- **Resolve and pin the endpoint's IP.** Registration refuses IP literals, `localhost` and `*.localhost` (unless listed in `PUSH_ENDPOINT_ALLOW_HOSTS`), but a public name can resolve to a private address, or change between check and send. The sender resolves the host once, refuses loopback, private (RFC 1918, `fc00::/7`), link-local (`169.254.0.0/16`, `fe80::/10`), CGNAT, unspecified and multicast addresses (and IPv4-mapped forms of them), connects to the address it checked, and never follows redirects. Allowlisted hosts skip the range check only.
- **Skip devices whose credential lapsed.** A row goes when its session or API key is deleted (sign out, session revoke, admin deactivation, token revoke) or its key is disabled. An expired session or key keeps its row until the session cleanup removes it, so the sender joins `session` or `apikey` and skips rows whose credential has expired, and skips users who are not active.
