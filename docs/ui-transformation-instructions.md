# UI Transformation Instructions

> **Instructions for AI models to apply the Retrospend Design System to any page**  
> Use these step-by-step instructions to transform UI components consistently.

---

## 📋 Prerequisites

Before starting, read and understand:
1. `/docs/design-system.md` - The complete design system
2. The target page's current React component code
3. The data structure being displayed

---

## 🎯 Transformation Process

### Step 1: Analyze the Current Page

**Questions to answer:**

1. **What type of page is this?**
   - Dashboard/Overview page
   - Detail/Analytics page
   - Management page (Budget, Settings, etc.)
   - Form/Entry page

2. **What is the PRIMARY metric?** (There should be exactly ONE)
   - The single most important number/value on this page
   - Examples: Total Net Worth, Monthly Spending, Budget Remaining

3. **What are the SECONDARY metrics?** (2-6 cards typically)
   - Supporting numbers that provide context
   - Examples: Income, Expenses, Category totals

4. **What visualization elements exist?**
   - Charts (pie, bar, line, area)
   - Tables
   - Lists
   - Heatmaps

5. **What is the semantic meaning of each metric?**
   - Positive/Growth (use green/emerald theme)
   - Warning/Caution (use amber theme)
   - Negative/Danger (use red/rose theme)
   - Neutral (use blue/cyan theme)

---

### Step 2: Identify Hero Card Candidate

**The hero card must be:**
- The single most important metric on the page
- A number that users check first
- Page-defining (e.g., "Net Worth" for Wealth, "Total Spending" for Dashboard)

**Hero Card Pattern:**
```tsx
<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
  {/* Decorative circles */}
  <div className="absolute top-0 right-0 h-64 w-64 translate-x-20 -translate-y-20 rounded-full bg-white/5" />
  <div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-16 translate-y-16 rounded-full bg-white/5" />
  
  <CardContent className="relative p-6 sm:p-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-300">
          {/* Label: e.g., "Total Net Worth" */}
        </p>
        <p className="text-4xl font-bold tracking-tight sm:text-5xl">
          {/* Main value */}
        </p>
        
        {/* Optional: Trend badge if there's change data */}
        {hasChangeData && (
          <div className="flex items-center gap-2 pt-1">
            <div className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium",
              isPositive
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-red-500/20 text-red-300"
            )}>
              <TrendIcon className="h-3.5 w-3.5" />
              {isPositive ? "+" : ""}{percentChange}%
            </div>
            <span className="text-sm text-stone-400">
              {changeDescription}
            </span>
          </div>
        )}
      </div>
      
      {/* Optional: Secondary info pill */}
      {hasSecondaryInfo && (
        <div className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 backdrop-blur-sm">
          <Icon className="h-5 w-5 text-stone-300" />
          <span className="text-sm text-stone-300">
            {secondaryLabel}: <span className="font-semibold text-white">{secondaryValue}</span>
          </span>
        </div>
      )}
    </div>
  </CardContent>
</Card>
```

**Required changes:**
- Import: `TrendingUp`, `TrendingDown` from `lucide-react`
- Import: `cn` from `~/lib/utils`
- Calculate: `isPositive`, `percentChange` from data
- Layout: Should be full-width, place at top of page

---

### Step 3: Transform Secondary Metrics to Semantic Cards

For each secondary metric, determine its semantic meaning:

#### GREEN Theme (Positive/Assets/Income)
**When to use:**
- Income, revenue, earnings
- Assets, savings, investments
- Under budget
- Positive growth

**Pattern:**
```tsx
<Card className="group relative overflow-hidden border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-lg hover:shadow-emerald-100 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card">
  <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover:scale-150" />
  
  <CardContent className="relative p-5">
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {label}
        </p>
        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
          {value}
        </p>
      </div>
      <div className="rounded-lg bg-emerald-100 p-2.5 dark:bg-emerald-900/50">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
    </div>
    
    {/* Optional: Subtitle metric */}
    {hasSubtitle && (
      <div className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600/80 dark:text-emerald-400/80">
        <SubIcon className="h-3.5 w-3.5" />
        <span>{subtitle}</span>
      </div>
    )}
  </CardContent>
</Card>
```

#### AMBER Theme (Warning/Liabilities/Caution)
**When to use:**
- Liabilities, debt, loans
- Budget warnings
- Near limits
- Pending actions

**Pattern:** Same as green, replace all instances of `emerald` with `amber`

#### RED/ROSE Theme (Danger/Overspending/Losses)
**When to use:**
- Over budget
- Losses, negative returns
- Critical alerts
- Failed states

**Pattern:** Same as green, replace all instances of `emerald` with `rose` or `red`

#### BLUE Theme (Neutral/Information)
**When to use:**
- General spending
- Neutral metrics
- Investment totals
- Information displays

**Pattern:** Same as green, replace all instances of `emerald` with `blue`

**Layout for secondary cards:**
```tsx
<div className="grid gap-4 sm:grid-cols-2">
  <Card>{/* Semantic card 1 */}</Card>
  <Card>{/* Semantic card 2 */}</Card>
</div>
```

Or for 3 cards:
```tsx
<div className="grid gap-4 md:grid-cols-3">
  <Card>{/* Card 1 */}</Card>
  <Card>{/* Card 2 */}</Card>
  <Card>{/* Card 3 */}</Card>
</div>
```

---

### Step 4: Update Chart Colors

#### Pie/Donut Charts

Replace generic `var(--chart-1)` colors with semantic vibrant colors:

```tsx
const chartConfig = {
  CATEGORY_1: {
    label: "Category Name",
    color: "hsl(217, 91%, 60%)", // Blue
  },
  CATEGORY_2: {
    label: "Category Name",
    color: "hsl(263, 70%, 50%)", // Violet
  },
  CATEGORY_3: {
    label: "Category Name", 
    color: "hsl(38, 92%, 50%)", // Amber
  },
  // Continue with palette rotation
} satisfies ChartConfig;
```

**Color rotation for categories:**
```tsx
const categoryColors = [
  "hsl(217, 91%, 60%)",  // Blue
  "hsl(263, 70%, 50%)",  // Violet
  "hsl(38, 92%, 50%)",   // Amber
  "hsl(160, 84%, 39%)",  // Emerald
  "hsl(0, 84%, 60%)",    // Rose
  "hsl(190, 84%, 50%)",  // Cyan
  "hsl(25, 95%, 53%)",   // Orange
];
```

#### Bar Charts

For positive/negative bars:
```tsx
const chartData = data.map((item) => ({
  ...item,
  fill: item.value >= 0 
    ? "hsl(160, 84%, 39%)"  // Emerald for positive
    : "hsl(0, 84%, 60%)",   // Rose for negative
}));
```

#### Line/Area Charts

```tsx
<Area
  dataKey="value"
  fill="hsl(217, 91%, 60%)"      // Blue
  fillOpacity={0.2}              // Subtle background
  stroke="hsl(217, 91%, 60%)"    // Blue line
  strokeWidth={2}
  type="monotone"
/>
```

---

### Step 5: Simplify Headers

**Remove duplicate controls:**
- If time range toggles appear in both header AND charts, keep only in charts
- Headers should focus on: Title + Primary Action Button

**Clean header pattern:**
```tsx
<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
  <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
  
  <Button>
    <Plus className="mr-2 h-4 w-4" />
    {primaryAction}
  </Button>
</div>
```

---

### Step 6: Review and Adjust

**Final checklist:**

- [ ] Hero card is clearly the most prominent element
- [ ] All secondary cards use appropriate semantic colors
- [ ] Charts use vibrant colors from the palette (no monotone grays)
- [ ] Hover effects work on all cards (`hover:shadow-lg hover:shadow-{color}-100`)
- [ ] Dark mode variants are included for all colored elements
- [ ] Icons are imported from `lucide-react`
- [ ] `cn` utility is imported for className composition
- [ ] Page layout flows: Hero → Secondary Grid → Charts → Tables/Lists
- [ ] Spacing is consistent using `space-y-4` or `space-y-6`
- [ ] No duplicate UI controls (check header vs. chart controls)

---

## 📝 Common Transformations

### Before: Flat Summary Cards

```tsx
// OLD - All cards look the same
<div className="grid gap-4 md:grid-cols-3">
  <Card>
    <CardHeader>
      <CardTitle>Net Worth</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{netWorth}</div>
    </CardContent>
  </Card>
  {/* Same for all other cards... */}
</div>
```

### After: Hero + Semantic Cards

```tsx
// NEW - Visual hierarchy with semantic colors
<div className="space-y-4">
  {/* Hero Net Worth */}
  <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl">
    {/* ...hero pattern... */}
  </Card>
  
  {/* Secondary semantic cards */}
  <div className="grid gap-4 sm:grid-cols-2">
    <Card className="...emerald theme...">
      {/* Assets card */}
    </Card>
    <Card className="...amber theme...">
      {/* Liabilities card */}
    </Card>
  </div>
</div>
```

---

## 🎨 Color Reference Quick Copy

```tsx
// Copy-paste color values
const colors = {
  emerald: "hsl(160, 84%, 39%)",
  amber: "hsl(38, 92%, 50%)",
  blue: "hsl(217, 91%, 60%)",
  violet: "hsl(263, 70%, 50%)",
  rose: "hsl(0, 84%, 60%)",
  cyan: "hsl(190, 84%, 50%)",
  orange: "hsl(25, 95%, 53%)",
};
```

---

## ⚠️ Common Pitfalls to Avoid

1. **❌ Creating multiple hero cards** - Only ONE hero card per page
2. **❌ Using wrong semantic colors** - Don't use red for positive metrics
3. **❌ Forgetting dark mode variants** - Always include `dark:` prefixes
4. **❌ Inconsistent hover states** - All cards need hover effects
5. **❌ Monotone charts** - Replace gray/stone with vibrant colors
6. **❌ Missing decorative circles** - Hero and semantic cards need the animated circles
7. **❌ Wrong text colors** - Match text colors to card theme (emerald-700, amber-700, etc.)
8. **❌ Overcrowding** - Maintain breathing room with proper spacing

---

## 🚀 Example Transformation Workflow

**Given:** A budget page with flat cards showing budget categories

**Step 1:** Identify primary metric → "Budget Remaining This Month"  
**Step 2:** Create hero card with budget remaining amount  
**Step 3:** Categorize secondary metrics:
- Categories under budget → Green cards
- Categories near limit → Amber cards  
- Categories over budget → Red cards

**Step 4:** Update partition bar colors to use vibrant category palette  
**Step 5:** Remove duplicate month selector from header (keep in chart)  
**Step 6:** Test hover states and dark mode

---

## 📚 Additional Resources

- Full design system: `/docs/design-system.md`
- Quick reference: `/docs/design-system-quick-ref.md`
- Example implementation: `/src/components/wealth/net-worth-summary.tsx`

---

**Version:** 1.0.0  
**Last Updated:** 2026-01-05
