# UI gaps

Where today's app breaks the rules in [GUIDELINE.md](GUIDELINE.md), so the ratchet baseline (`src/test/uiRules/baseline.json`) makes sense. Numbers are from the commit that added the rulebook (main at 1431b28). Regenerate the tables with `pnpm ui:ratchet --report`.

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
| UI-070 | 72 | 41 | Number, money or date formatted by hand |
| UI-071 | 16 | 7 | Money string built by hand |
| UI-100 | 35 | 28 | Duration off the motion tokens (mostly 300 and 500) |
| UI-101 | 1 | 1 | Overshoot easing (`settle-pop-in` in `globals.css`) |
| UI-120 | 41 | 13 | Em dash in UI text (32 of them in `messages/*.json`) |
| UI-121 | 81 | 12 | Glossary word (55 in `messages/en.json`: participant, login, shadow profile, square up...) |
| UI-130 | 26 | 17 | Outline removed without a focus-visible replacement (19 in primitives) |
| UI-131 | 18 | 11 | Icon-only button without an accessible name |
| **Total** | **3229** | **267** | |

## 2. Where they are

| Area | Hits | Biggest rules |
|---|---|---|
| App pages and components (`src/app` minus site, `src/components` minus ui, `src/hooks`) | 1585 | palette colors 606, spacing 256, font sizes 176, legacy imports 73 |
| Site: landing, docs, public profile and pay pages (`src/app/(site)`) | 933 | spacing 251, font sizes 230, weights 166, palette 125 |
| `src/lib` | 356 | palette 284 and raw colors 59, almost all in the category color map |
| Primitives (`src/components/ui`) | 260 | radius 58, palette 56, spacing 46, shadows 37, outline 19 |
| Message catalogs (`messages/*.json`) | 87 | glossary 55, em dashes 32 |
| Styles (`src/styles/globals.css`) | 8 | glass header and stripes literals, gradient, overshoot, 300ms |

Top offenders:

| File | Hits | Rules |
|---|---|---|
| src/lib/constants.ts | 326 | UI-002 284, UI-001 42 (the category color map is Tailwind palette classes; categories need `category-n` tokens) |
| src/components/budget/budget-header.tsx | 84 | UI-002 50, UI-010 14, UI-012 5, UI-031 4, UI-011 4, UI-030 2 |
| src/app/(dashboard)/people/[type]/[id]/page.tsx | 67 | UI-002 32, UI-020 18, UI-010 8 |
| src/app/(dashboard)/projects/page.tsx | 64 | UI-002 38, UI-020 6, UI-031 4, UI-021 4, UI-030 2 |
| messages/en.json | 59 | UI-121 55, UI-120 4 |
| src/app/(dashboard)/_components/recent-expenses.tsx | 55 | UI-002 46 |
| src/components/settings/payment-methods-card.tsx | 49 | UI-020 26, UI-002 12 |
| src/components/ui/stat-card.tsx | 47 | UI-002 31, UI-031 9 (the glow tile; legacy) |
| src/app/(dashboard)/people/page.tsx | 44 | UI-002 25, UI-020 5 |
| src/app/projects/[id]/page.tsx | 43 | UI-010 13, UI-002 11, UI-011 10 |
| src/app/(site)/docs/features/projects/page.tsx | 39 | UI-010 10, UI-020 10, UI-011 9, UI-121 8 |
| src/app/(site)/docs/configuration/storage/page.tsx | 36 | UI-020 14, UI-010 9, UI-011 8 |
| src/app/(site)/docs/self-hosting/page.tsx | 36 | UI-020 15, UI-010 7, UI-021 7 |
| src/components/people/people-timeline-columns.tsx | 34 | UI-002 31 |
| src/app/(site)/_components/landing/demo-splitting.tsx | 33 | UI-002 9, UI-020 9, UI-070 5, UI-071 4 |

### Allowed exceptions (`src/test/uiRules/allow.json`)
UI-001 only: the Open Graph image files (satori has no CSS variables), third-party brand colors (payment apps, the Matrix link) and the Recharts attribute selectors in `ui/chart.tsx`. Nothing else is exempt.

## 3. Switch-over: from the legacy theme to the design tokens

The design tokens (`src/styles/tokens.css`, generated from `design.json`) are loaded next to the legacy shadcn theme in `globals.css`. They add variables and utilities (`bg-surface`, `text-fg-2`, `h-ctl`, `rounded-panel`, `shadow-menu`, `text-title`...) and change nothing on screen. Today the app uses the legacy color utilities about 2,500 times in 235 files.

Changing the legacy values in place would restyle every page at once (the dark theme is neutral gray today, the design's dark theme is warm; `muted-foreground`, `border` and `card` differ from `fg-3`, `line` and `surface`). So the switch happens page by page:

1. **Primitives first.** Rebuild `src/components/ui` on the design tokens (button, input, select, chip, segmented, tabs, sheet, menus, table). This clears most of UI-021, UI-031 and UI-130 in one place and gives pages the right controls.
2. **Pages, one at a time,** as each overhaul page is built: new components, design tokens only, the baseline lowered in the same branch.
3. **Rename the accent.** Replace the remaining `bg-accent` / `text-accent-foreground` hover uses (119 in 37 files, mostly primitives) with `bg-raised` / `text-fg`, then rename `ds-accent` to `accent` in `design.json` (drop its `css` field) and regenerate.
4. **Remove the legacy theme** from `globals.css` (the `:root` and `.dark` blocks, `--chart-*`, `--sidebar-*`, the glass header) once nothing references it. Promote UI-006 to [auto] at that point.

Values that change for people when a page switches (expected, decided):
- **Dark theme** turns from neutral gray (chroma 0) to the warm dark of the design.
- **Avatar colors:** today 10 Tailwind 700 hexes (`ui/user-avatar.tsx`, name hash mod 10); the design has 8 avatar tokens (mod 8), so some people get a new color once. Do it in one change, not page by page.
- **Category colors:** today Tailwind palette classes in `src/lib/constants.ts`; the design has 21 `category-n` tokens. Map them once (stored category color names → token numbers).
- **Money format:** today `formatCurrency` shows symbols ("AR$1,234,567", "R$51.90"). The design shows the ISO code for foreign and every "$" currency ("ARS 1,234,567", "BRL 51.90"). This is a formatter change in `src/lib/currency-format.ts`, with its tests, before pages adopt the new money display.
- **Charts:** `src/lib/chart-theme.ts` and the chart components use hex colors; move them to `var(--series-n)` and `var(--category-n)`.

## 4. Findings in the design itself

- **Light attention (amber) is 2.1:1 on bg,** below the 3:1 graphics floor. The amber dot and bar always come with a word ("Overspent"), so meaning never rests on it, but an amber progress bar alone would fail. Kept as the kit has it; flag for the owner if amber needs to stand alone.
- **Category colors reach 2.9:1 at worst in light** (graphics floor 3:1). Categories always come with a name or glyph.
- **Every text token passes 4.5:1** on bg, surface and raised in both themes (UI-004 checks 100 pairs); series pass 3:1; avatar initials pass 5.2:1.

## 5. Not enforced automatically

These are review items because a scan cannot judge them reliably: layout order and tile rows (UI-050, UI-051), the same fact twice (UI-052), alignment of money edges and control heights (UI-022, UI-060), whether an icon adds nothing (UI-036), color doing its one job (UI-005), legacy token use in new code (UI-006, until the switch-over), money math on the client (UI-072), previews and Undo on money actions (UI-075), faces and identity in pickers (UI-080, UI-081), motion quality (UI-103), states (UI-110) and most of the glossary (UI-123). Known blind spots of the scan itself are listed at the top of `src/test/uiRules/rules.ts` (implicit 150ms on `transition`, date-fns `format`, a currency symbol held in a variable, class lists split across literals).

## 6. Superseded docs

`docs/design-system.md` (gradient hero cards, tinted semantic cards, decorative circles) and `docs/web-experience/design-language.md` (codified the pre-overhaul pages, including StatCard and `duration-300`) now point here. Their old text is in git history.
