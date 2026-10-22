<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design language (strict)

Retrospend has one design language, decided with the owner. These rules override your habits and any older code you see. The full rules are in `docs/ui/GUIDELINE.md` (§ numbers below); the checks are in `docs/ui/CHECKLIST.md`.

1. **Tokens only** (§2). Colors, type sizes, spacing, radii, shadows and durations come from the design tokens (`docs/ui/design.json`, generated into `src/styles/tokens.css` by `pnpm ui:tokens`). No raw hex, rgb, hsl or oklch, no Tailwind palette colors (`emerald-600`, `bg-white`), no arbitrary `[..]` values, nothing off the type scale (12 to 32, weights 400/500/600) or the 4/8/12/16/24/32/48 spacing scale. The teal accent is `ds-accent` until the switch-over; `bg-accent` is the legacy hover gray.
2. **One color, one job** (§2.1). Brand: primary button, focus, selection, active nav. Accent: data and identity. Positive: money to you. Attention: needs you. Danger: destructive and errors. Categories mean only "which category". Status is a word plus a color, never color alone.
3. **One primitive per job** (§4). Check `src/components/ui/registry.ts` before writing markup. Use a core primitive for its job; never import a legacy or internal one, never write a raw `<button>`, `<input>`, `<select>` or `<table>` outside `src/components/ui`, never build a lookalike. A new primitive, token, color or icon style needs the owner's sign-off first: stop and propose it.
4. **No vibecoded tells** (§17, R31). No gradients, glows, blobs or decorative shadows; no colored accent stripes or top/side borders on sheets, cards or banners; no sparkle, magic wand or stars icons; no icon that adds nothing next to a clear label; no tinted icon tiles in chips or pickers (category tiles only in list and table rows); no bordered cards around sections, no tile rows of numbers, no uppercase eyebrows, no emoji.
5. **Layout** (§3). Header (title, at most one primary, overflow) → Toolbar → Content. Flat sections. At most one hero number. A fact appears once per screen. Controls in one row share one height.
6. **Money** (§7). The server computes every figure; the client formats it through the money formatter (`useCurrencyFormatter`, `src/lib/currency-format.ts`). Never `toFixed`, `toLocaleString`, `Intl.*` or a hand-built "$" in UI code. Foreign amounts show the ISO code, original first and home second, with the rate type when it is not the default. Money columns right-align to one edge with tabular figures. A missing rate is never 1.
7. **Money actions preview and undo** (§7, R30, R15). Every action that changes money shows what will change and what will not before Save, and ends with an Undo toast.
8. **Faces** (§8). A set of people shows faces (AvatarStack); pickers and filter menus carry identity (face, cover, bare category glyph, group dot).
9. **Motion** (§11). Durations from the tokens (120 state, 160 menus, 200 rows, 220 sheets and tabs). Animate state changes only. No bounce or overshoot, never on money. Reduced motion: opacity only.
10. **Words** (§13). US English, sentence case, one short sentence at most, the glossary's words (Expense, Person, Settle up, Sign in, Recurring expense, Not planned yet). No em dashes anywhere: UI copy, message catalogs, code strings, docs, comments.
11. **Accessibility floor** (§14). Token contrast is tested; keep focus visible (never drop an outline without a focus-visible replacement); every icon-only button has an `aria-label` and a tooltip; status never by color alone; 44pt touch targets on phones.
12. **Platforms** (§10, §15). Desktop dialogs, phone bottom sheets with detents, native chrome on iOS (HIG, glass on chrome only) and Android (Material 3). Native apps read `docs/ui/design.json` (hex values) instead of copying numbers.
13. **The ratchet** (`src/test/uiRules`, runs in `pnpm check`). Never raise `baseline.json`, add to `allow.json`, or edit GUIDELINE or CHECKLIST to make a check pass. When you fix violations, lower the baseline with `pnpm ui:ratchet` in the same commit.

### Before you touch UI

1. Read `docs/ui/GUIDELINE.md` (at least §1, §2 and the sections for what you are building) and `docs/ui/GAPS.md` §3 if you touch legacy styling.
2. Find the component in `src/components/ui/registry.ts`. For how a screen should look, open the mockup kit's gallery and the page mockup: `docs/ui-overhaul/mockups/components.html` and `docs/ui-overhaul/mockups/<page>.html` in the main checkout (`/home/matv/Projects/retrospend/docs/ui-overhaul/`, local only, not in worktrees).
3. Build with tokens and registered primitives only.
4. Run `pnpm check` (typecheck, lint, tests including uiRules). If you fixed violations, run `pnpm ui:ratchet` to lower the baseline.
5. Walk `docs/ui/CHECKLIST.md` and report every item by ID (`UI-020 pass`, `UI-075 n/a (no money action)`, `UI-052 fail file:line`), with before and after screenshots at 1440 and 390, light and dark.
