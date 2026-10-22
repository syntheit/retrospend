# UI checklist

Walk it on every UI change. Report each item by ID: `UI-020 pass`, `UI-075 n/a (no money action)`, `UI-052 fail src/app/(dashboard)/people/page.tsx:120`. Never skip an item silently.

- **[auto]**: a source scan enforces it (`src/test/uiRules`, runs in `pnpm check`). Existing violations are recorded per file in `baseline.json`; the count can only go down. Fix the code; never raise the baseline or add to `allow.json` to make a check pass.
- **[review]**: you (and the reviewer) check it by looking at the screen and the diff.
- Each item names its GUIDELINE section (§) and PLAN rule (R).

## Tokens and color
- UI-001 [auto] No raw color literals (hex, `rgb()`, `hsl()`, `oklch()`, `oklab()`, `hwb()`) outside the token files; in `globals.css` only inside custom-property declarations. §2.1 R6
- UI-002 [auto] No Tailwind palette colors (`text-emerald-600`, `bg-blue-500/10`, `bg-white`, `text-black`...). §2.1 R6
- UI-003 [auto] `docs/ui/design.json`, its hex values and `src/styles/tokens.css` are in sync (`pnpm ui:tokens`), and `globals.css` imports the token file. §2
- UI-004 [auto] Contrast floor: text tokens 4.5:1 on bg, surface and raised; text on fills 4.5:1; white initials on avatars 4.5:1; accent and series 3:1 on bg; both themes. §14
- UI-005 [review] Each color does its one job: brand only primary button, focus, selection, active nav; accent only data and identity; positive only money to you; attention only needs you; danger only destructive and errors; categories only categories. §2.1 R6 R19
- UI-006 [review] New code uses the design tokens (`bg-surface`, `text-fg-2`, `border-line`...), not the legacy shadcn tokens (`muted-foreground`, `card`, `accent`). §2.1
- UI-007 [review] The screen keeps the ratio: warm neutrals about 70%, brand 10 to 15%, accent about 10%, meaning colors only where meaning exists. §2.1 R19

## Type
- UI-010 [auto] Font sizes from the scale only: no `text-lg` and up, no `text-[Npx]`, no `fontSize` in style props, no off-scale `font-size` in CSS (px or rem; em only `1em`); nothing under 12px. CSS `@apply` lists get every class rule. §2.3 R12
- UI-011 [auto] Weights 400, 500, 600 only: no `font-bold`, `font-black`, `font-light`... §2.3 R12
- UI-012 [auto] No uppercase or letter-spaced eyebrows (`uppercase`, `tracking-wide*`, `text-transform: uppercase`). §2.3 R12
- UI-013 [review] Mono only for strings you would paste; every number has tabular figures. §2.3

## Space, size and shape
- UI-020 [auto] Spacing on the 4, 8, 12, 16, 24, 32, 48 scale: no off-scale steps (`1.5`, `2.5`, `5`, `10`...) and no arbitrary `p-[..]`, `m-[..]`, `gap-[..]` unless they only wrap a token or the safe area. §2.4 R31
- UI-021 [auto] Radius from the tokens: no `rounded-sm`, `rounded-md`, bare `rounded`, `rounded-2xl` and up, or `rounded-[..]`. §2.4 R31
- UI-022 [review] Controls in one row share one height (`h-ctl`, or all `h-ctl-sm`) and one baseline; labels and fields sit on one grid. §5 R31
- UI-023 [review] Borders only around objects you act on (table, sheet, menu, input, phone list group); nothing bordered is nested. §3 R2

## Decoration (R31)
- UI-030 [auto] No gradients (`bg-gradient-*`, `bg-linear-*`, `*-gradient()`). §17 R31
- UI-031 [auto] No glows or decorative shadows: only `shadow-menu` and `shadow-ctl`; no `shadow-lg`, colored or arbitrary shadows, `box-shadow` outside tokens, or `blur-*` blobs. §2.5 R31
- UI-032 [auto] No accent stripes: no 2px+ or colored one-sided borders (`border-l-4`, `border-t-2`, `border-l-primary`, `border-left: 3px`). §17 R31
- UI-033 [auto] No sparkle, magic wand or stars icons (`Sparkles`, `WandSparkles`, `Wand2`, `Stars`, tabler equivalents). §2.7 R31
- UI-034 [auto] One icon set: lucide-react only. §2.7
- UI-035 [auto] No emoji in UI text (JSX, string literals, message catalogs). §2.7
- UI-036 [review] No icon that adds nothing next to a clear label; no colored icon before a sheet title; chips are text only; category tiles only in list and table rows, bare glyphs in menus and pickers. §2.7 §5 R25 R31
- UI-037 [review] No decorative illustrations, blobs, dashed pills or rings, or dotted underlines on values; the project cover is the only artwork. §17 R31

## Components
- UI-040 [auto] Every file in `src/components/ui` has an entry in `registry.ts` with its job and status; a new primitive needs the owner's sign-off. §4 R18
- UI-041 [auto] No import of a legacy primitive (`card`, `stat-card`, `toggle`, `toggle-group`) or an internal one (`dialog`, `drawer`, `sheet`, `alert-dialog`, `avatar`, `calendar`) outside `src/components/ui`, by import, re-export or dynamic `import()`, through `~/` or a relative path. §4 R2 R3 R7 R18
- UI-042 [auto] No raw `<button>`, `<input>` (other than file and hidden), `<select>`, `<textarea>`, `<table>` outside `src/components/ui`. §4 R18
- UI-043 [review] The right component for the job per the decision table; no lookalike built. §4 R18
- UI-044 [review] Segmented switches views of the same data in place; underline tabs move between sibling pages or panes; never two of the same kind stacked; nothing looks like one and acts like the other. §5 R7 R21
- UI-045 [review] Every action is defined once in the action registry; ⋯ menu, right-click, long press and swipe read it; one sheet or page per task. §4 §10 R8
- UI-046 [review] At most one primary button per header; Danger only on a destructive confirm; labels verb first; no icons on footer buttons. §4

## Layout
- UI-050 [review] Header (title, at most one primary, overflow) → Toolbar → Content; nothing between header and toolbar. §3 R1
- UI-051 [review] No tile rows; at most one hero number; other key numbers in a glance line or key-value rows. §3 R3
- UI-052 [review] A fact appears once per screen. §1 R4
- UI-053 [review] Desktop space is filled with useful content tied to the page's job; rows show only what a person acts on. §3 R26 R29
- UI-054 [review] Works at 1440, 1024, 768 and 390 wide, light and dark; phone screens are designed for the task, not reflowed. §3 R13

## Tables and rows
- UI-060 [review] Money right-aligns to one edge across group headers, rows and totals (`mr-trail`); tabular figures. §6 R27
- UI-061 [review] One lead slot per row; rows in a group all have the ⋯ column or none; identity columns have fixed widths so faces start on one edge. §6 R27 R31
- UI-062 [review] Hover and right-click only on fine pointers; every swipe has a menu twin; phone web has no swipe. §6 R13

## Money
- UI-070 [auto] Numbers, money and dates go through the formatters: no `toFixed`, `toLocaleString` or `Intl.NumberFormat` outside `packages/domain` and `src/server/services` (anywhere else in `src`, server code and today's `src/lib` formatters included); no `toLocaleDateString`, `toLocaleTimeString`, `Intl.DateTimeFormat` or `Intl.RelativeTimeFormat` outside the date helpers (`src/lib/date-locale.ts`, `date.ts`, `time-zone.ts`). §7 R10, IMPLEMENTATION §4
- UI-071 [auto] No hand-built money strings: no currency symbol written next to an interpolated value or after it (`` `$${x}` ``, `` `${x} €` ``, `"€" + x`, `<span>${x}</span>`, `<span>{x} €</span>`). §7 R10
- UI-072 [review] The client never converts, sums or rounds money; it formats what the server sends; a missing rate is never 1. §7 R9
- UI-073 [review] Foreign amounts show the ISO code, original first and home second; the rate type shows when it is not the default; a "$" currency always shows its code. §7 R10
- UI-074 [review] Zero, missing rate, extreme (7+ digit ARS, 0.004 ETH), loading and unavailable states are designed and shown. §7 R14
- UI-075 [review] Every money action previews what changes and what doesn't before Save, and ends with an Undo toast. §7 R30 R15
- UI-076 [review] Owed to you and You owe are two lines, never netted; owing is plain text with the words; status is word plus color. §7 R5
- UI-077 [review] No display-size number inside an input; amount inputs are `h-money`, 16px medium. §5 §7 R22

## People
- UI-080 [review] A set of people shows faces (stack, hover spreads, name tooltip, +N); the Names setting swaps them for names. §8 R20
- UI-081 [review] Pickers and filter menus carry identity (face, cover, bare category glyph, group dot) in one 24px lead slot. §5 R25
- UI-082 [review] A person's color comes from the avatar map, never picked by hand. §2.2 §8

## Charts
- UI-085 [review] One question per chart; series tokens in order; every series labeled; categories only in category charts; no rainbow ranked lists; hover tooltip; gaps are null. §9 R19

## Sheets and platforms
- UI-090 [review] Sheets: dialog on desktop, detent sheet on phone; title is text only; no stripe or colored border; Cancel plus the specific verb. §10 R8 R13 R31
- UI-091 [review] iOS follows the HIG: thumb zone, no critical gesture near the top edge, glass on chrome only; Android uses Material 3 equivalents. §15 R17 R28
- UI-092 [review] Feature parity: a redesigned screen keeps every field and toggle of the old one, and the PR lists each. §17 R23

## Motion
- UI-100 [auto] Durations from the motion tokens only (80, 120, 140, 160, 200, 220 ms or `duration-(--t-*)`), in classes, CSS and style props. §2.6 §11 R24
- UI-101 [auto] No bounce or overshoot: no `cubic-bezier` with y outside 0 to 1, no `animate-bounce` or `animate-ping`. §11 R24
- UI-102 [auto] Reduced motion is honored in `tokens.css` and `globals.css`. §11 R24
- UI-103 [review] Tabs slide on a shared axis; sheets, row inserts and removals and changing numbers animate; nothing animates for decoration; reduced motion is opacity only. §11 R24

## States
- UI-110 [review] Empty (one line + one action), filtered empty (Clear filters), loading (skeleton in place) and error (Couldn't + Retry) exist for every list and number. §12 R14
- UI-111 [review] Shared surfaces (balances, Needs you, verifications) refresh after their mutations and on a poll or push. R16

## Wording
- UI-120 [auto] No em dashes in UI text: string literals, JSX text, `messages/*.json`, including the `&mdash;` and `&#8212;` entities. §13 R11
- UI-121 [auto] No words the glossary replaces in English copy (translation keys such as `t("receivable")` are not copy) (log in, log out, login, participant, shadow profile, square up, pay off, receivable, payable, portfolio). §13 R11
- UI-124 [auto] No literal English in JSX: text children, string children (`{"Save"}`, `{ok ? "Yes" : "No"}`) and the copy props `placeholder`, `title`, `aria-label`, `alt`, `label`, `description`, `tooltip`, `heading` go through `t()`. Code samples in `<code>`, `<pre>`, `<kbd>` and words without a lowercase letter (`USD`) are not counted. §13 R11
- UI-122 [review] US English, sentence case, at most one short sentence; the interface shows the rule instead of explaining it. §13 R11
- UI-123 [review] Nouns and verbs follow the glossary table (Expense, Person, Settle up, Recurring expense, Not planned yet...). §13

## Accessibility
- UI-130 [auto] No outline removed (`outline-none`, `outline-hidden`, any variant including `focus-visible:`) without a visible `focus-visible:` replacement (`ring-0`, `ring-offset-*` alone do not count). §14
- UI-131 [auto] Icon-only buttons (`size="icon*"`, or a `Button` or `<button>` whose only content is an icon, with no text, `t()` or `sr-only` child) have an accessible name (`aria-label`, also on an `asChild` link). §14
- UI-132 [review] Status is never color alone; focus is visible; everything is reachable by keyboard; sheets trap and return focus. §14 R5
- UI-133 [review] Targets: 24px on desktop web, 44pt iOS, 48dp Android. §14 §15

## Process
- UI-140 [auto] The ratchet passes: no rule and file above `baseline.json`; fixes lowered with `pnpm ui:ratchet`; `allow.json` entries carry a real reason. Before merging a branch: `pnpm ui:ratchet --check-base <main's baseline.json>`.
- UI-141 [review] Before and after screenshots of every changed screen: 1440 and 390, light and dark.
- UI-142 [review] Results reported by ID in the final message or PR.

## Code shape
- UI-150 [auto] File size limits: component (`.tsx`) 300 lines, service (`src/server/services`) 500, router (`src/server/api/routers`) 300. Existing files over the limit are in the baseline (counted in lines over the limit) and may only shrink. IMPLEMENTATION §8.2
- UI-151 [auto] No `~/server/db` import (static, dynamic or re-export; type-only imports are fine) in transport files (`src/server/api/**`, `src/app/api/**`): they call services. IMPLEMENTATION §2.2
- UI-152 [review] No arithmetic on money fields (`a.amount + b.amount`, `* rate`, `Math.round(total)`) outside `packages/domain` and `src/server/services`. A scan cannot tell a money field from a count, so the reviewer checks it. IMPLEMENTATION §4
