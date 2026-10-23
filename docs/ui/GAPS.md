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
| Public profile (`/u/{username}`) | A link from Settings, Profile; the new account menu's Your profile opens Settings as the mockup says, so the public page has no entry in the new shell | Reachable by URL only | S4H settings |
| Sidebar group label letter spacing | A tracking token for the one eyebrow the guideline allows | `tracking-wider` on the sidebar's Tools and Pinned labels (allow.json UI-012) | S0a tokens |
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

## 8. Behavior gaps found by the e2e suite

- **Clicks before hydration do nothing (S4).** Buttons rendered on the server (Add Expense, New Project, the user menu) ignore a click that lands before React hydrates; the user has to click again, and nothing says the page is not ready yet. The e2e suite waits for `html[data-hydrated="true"]` (`src/components/hydration-marker.tsx`) before it clicks. The v2 pages should either work without JavaScript for their primary action or show it as not ready until hydration.
- **Profile form labels point nowhere (S4).** In `src/components/settings/profile-section.tsx` the labels use `htmlFor="name"` (and `username`, `email`) while `FormControl` gives each input a generated id, so screen readers announce the fields without their labels. The e2e spec selects the name field by `input[name="name"]` until the form is rebuilt.
