# Retrospend Design System & UI Guidelines

## Core Philosophy

**"Semantic Density."**
The UI follows a "Clean Modernism" aesthetic. It must look premium in Dark Mode but fully functional in Light Mode.

1.  **Strictly Semantic:** NEVER hardcode color scales (e.g., `bg-stone-900`, `text-stone-400`) for structural elements. Always use Shadcn/Tailwind semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`).
2.  **Hierarchy via Typography:** Use font weight and tracking to separate data.
3.  **Data > Containers:** Minimal borders. Let charts and numbers create the structure.

## 1. Color Palette (Theme Aware)

- **Backgrounds:**
  - Page: `bg-background` (Handles the switch between Stone-950 and White automatically).
  - Card: `bg-card` with `text-card-foreground`.
  - Subtlety: Use `bg-muted/50` for secondary areas (like table headers).
- **Accents (Functional):**
  - **Primary:** `text-primary` / `bg-primary`.
  - **Positive:** `text-emerald-500` (Dark) / `text-emerald-600` (Light).
  - **Warning:** `text-amber-500` (Dark) / `text-amber-600` (Light).
  - **Destructive:** `text-destructive`.
- **Text:**
  - **Headings:** `text-foreground`.
  - **Meta/Labels:** `text-muted-foreground`.
  - **Crucial:** Never use `text-white` or `text-black`. Always use `text-foreground` or `text-primary-foreground`.

## 2. Typography Rules (Updated)

- **Primary Font:** Use the default Sans font (Inter/Geist) for everything.
- **Numbers:**
  - **ALWAYS** use `tabular-nums` for financial data, prices, and tables.
  - _Why:_ This aligns numbers vertically (like monospace) without the ugly aesthetic of monospace fonts.
  - _Exception:_ You may use `font-mono` ONLY for API Keys, Transaction IDs, or code snippets.
- **KPI Labels:** `uppercase text-[10px] tracking-widest font-semibold text-muted-foreground`.
- **Big Metrics:** `text-3xl font-bold tracking-tight text-foreground tabular-nums`.

## 3. Component Patterns

### A. The "Spotlight" Card (KPIs)

- **Structure:** "Four Corners" layout.
- **Background:** `bg-card border border-border shadow-sm`.
- **Gradient Glow:**
  - Use semantic opacity: `bg-primary/5` or `bg-emerald-500/10`.
  - Do NOT use hardcoded `bg-stone-900`.

### B. Lists (Activity / Exchange Rates)

- **Icons:**
  - Container: `rounded-full bg-primary/10 flex items-center justify-center`.
  - Icon: `w-4 h-4 text-primary`.
- **Text:**
  - Primary: `text-sm font-medium text-foreground`.
  - Secondary: `text-[10px] text-muted-foreground`.

### C. Charts

- **Tooltips:** Use `contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}` to respect the theme.
