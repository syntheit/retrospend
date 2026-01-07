# Retrospend Design System

> **Premium Financial UX Guidelines**  
> Establishing consistent, vibrant, and semantic design patterns across the entire app.

---

## 🎨 Core Design Philosophy

Our design system emphasizes:
- **Visual Hierarchy**: Important metrics stand out through size, color, and placement
- **Semantic Colors**: Colors convey meaning (positive/negative, category types)
- **Premium Feel**: Gradients, subtle animations, and depth create polish
- **Consistency**: Patterns repeat across pages for familiarity

---

## 🌈 Color Palette & Semantic Meanings

### Financial Status Colors

| Color | HSL | Usage | Example |
|-------|-----|-------|---------|
| **Emerald** | `hsl(160, 84%, 39%)` | Assets, Income, Positive Growth | Total Assets card, positive trends |
| **Amber** | `hsl(38, 92%, 50%)` | Liabilities, Warnings, Caution | Total Liabilities, budget warnings |
| **Blue** | `hsl(217, 91%, 60%)` | Investments, Savings Goals | Investment allocation, savings |
| **Violet** | `hsl(263, 70%, 50%)` | Crypto, Alternative Assets | Crypto holdings, special categories |
| **Rose/Red** | `hsl(0, 84%, 60%)` | Overspending, Negative Trends | Budget exceeded, losses |
| **Cyan** | `hsl(190, 84%, 50%)` | Transactions, Neutral Activity | Transaction flow, general activity |
| **Orange** | `hsl(25, 95%, 53%)` | Other/Miscellaneous | Uncategorized, other |

### Category Visualization

For expense/budget categories, use vibrant, distinct colors:
- Should use the existing `CATEGORY_COLOR_MAP` but enhance with better saturation
- Each category should be immediately recognizable by its color
- Use the same colors across all views (dashboard, budget, analytics) for consistency

---

## 🎯 Hero Card Pattern

**When to use:** For the single most important metric on a page.

### Design Specs
```tsx
<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl dark:from-stone-900 dark:via-stone-800 dark:to-black">
  {/* Decorative background circles */}
  <div className="absolute top-0 right-0 h-64 w-64 translate-x-20 -translate-y-20 rounded-full bg-white/5" />
  <div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-16 translate-y-16 rounded-full bg-white/5" />
  
  <CardContent className="relative p-6 sm:p-8">
    {/* Main metric */}
    <p className="text-4xl font-bold tracking-tight sm:text-5xl">
      {mainValue}
    </p>
    
    {/* Trend badge */}
    <div className={cn(
      "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium",
      isPositive ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
    )}>
      <TrendIcon className="h-3.5 w-3.5" />
      {percentChange}%
    </div>
  </CardContent>
</Card>
```

### Where to apply:
- **Dashboard**: Total spending this month
- **Budget**: Budget remaining (or overspent amount)
- **Wealth**: Total net worth ✅ (already implemented)
- **Analytics**: Total analyzed period spending

---

## 💳 Semantic Summary Cards

**When to use:** For secondary metrics that need color-coding.

### Pattern: Positive/Growth Cards (Green Theme)
```tsx
<Card className="group relative overflow-hidden border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-lg hover:shadow-emerald-100 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card">
  {/* Animated background circle */}
  <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover:scale-150" />
  
  <CardContent className="relative p-5">
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Label</p>
        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{value}</p>
      </div>
      <div className="rounded-lg bg-emerald-100 p-2.5 dark:bg-emerald-900/50">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
    </div>
  </CardContent>
</Card>
```

### Pattern: Warning/Alert Cards (Amber Theme)
- Same structure, replace `emerald` with `amber`
- Use for: Liabilities, Budget warnings, Overdue items

### Pattern: Danger/Negative Cards (Rose/Red Theme)
- Same structure, replace `emerald` with `rose` or `red`
- Use for: Overspending, Losses, Critical alerts

### Where to apply:
- **Dashboard**: Income card (green), Spending card (amber if over budget, else cyan)
- **Budget**: Categories over budget (red), under budget (green)
- **Wealth**: Assets (green) ✅, Liabilities (amber) ✅
- **Analytics**: Top category card (use category color with same pattern)

---

## 📊 Chart Color Standards

### Pie/Donut Charts
Use vibrant, semantically meaningful colors:

```tsx
{
  CASH: "hsl(160, 84%, 39%)",        // Emerald
  INVESTMENT: "hsl(217, 91%, 60%)",   // Blue
  CRYPTO: "hsl(263, 70%, 50%)",       // Violet
  REAL_ESTATE: "hsl(38, 92%, 50%)",   // Amber
  OTHER: "hsl(25, 95%, 53%)",         // Orange
}
```

### Bar Charts
- **Positive values**: `hsl(160, 84%, 39%)` (Emerald)
- **Negative values**: `hsl(0, 84%, 60%)` (Rose)
- **Neutral**: `hsl(217, 91%, 60%)` (Blue)

### Line/Area Charts
- **Main trend**: `hsl(217, 91%, 60%)` (Blue) with gradient fill
- **Comparison lines**: Use contrasting colors from palette
- **Fill opacity**: 0.2 for subtle background

### Multi-Category Visualizations
Use the vibrant palette in rotation:
```tsx
const chartColors = [
  "hsl(217, 91%, 60%)",  // Blue
  "hsl(263, 70%, 50%)",  // Violet
  "hsl(38, 92%, 50%)",   // Amber
  "hsl(160, 84%, 39%)",  // Emerald
  "hsl(0, 84%, 60%)",    // Rose
  "hsl(190, 84%, 50%)",  // Cyan
  "hsl(25, 95%, 53%)",   // Orange
];
```

---

## 🎭 Interactive States

### Hover Effects
All cards should have smooth hover transitions:
```tsx
className="transition-all duration-300 hover:shadow-lg hover:shadow-{color}-100"
```

### Focus States
Use semantic ring colors:
```tsx
className="focus:ring-2 focus:ring-{color}-500 focus:ring-offset-2"
```

### Loading States
Skeleton loaders should match card backgrounds (emerald-50, amber-50, etc.)

---

## 📐 Layout Patterns

### Hero + Secondary Grid
```tsx
<div className="space-y-4">
  {/* Hero card - full width */}
  <Card>...</Card>
  
  {/* Secondary cards - 2 column grid */}
  <div className="grid gap-4 sm:grid-cols-2">
    <Card>...</Card>
    <Card>...</Card>
  </div>
</div>
```

### Dashboard Grid
```tsx
<div className="grid gap-6 lg:grid-cols-7">
  <div className="lg:col-span-4">{/* Main chart */}</div>
  <div className="lg:col-span-3">{/* Secondary viz */}</div>
</div>
```

---

## 🚀 Implementation Roadmap

### Phase 1: Dashboard (Home Page)
- [ ] Create hero card for "Total Spending This Month"
- [ ] Convert stats to semantic summary cards (Income=green, Spending=blue/amber)
- [ ] Update category donut chart colors to use vibrant palette
- [ ] Add decorative circles to main cards

### Phase 2: Budget Page
- [ ] Create hero card for "Budget Status" (remaining or overage)
- [ ] Convert partition bar to use vibrant category colors
- [ ] Add semantic cards for total allocated vs spent
- [ ] Update budget list items with colored accent borders

### Phase 3: Analytics Page
- [ ] Create hero card for selected period total
- [ ] Add semantic cards for top categories
- [ ] Update heatmap color scale
- [ ] Enhance trend charts with gradients

### Phase 4: Global Enhancements
- [ ] Update all empty states with brand colors
- [ ] Add subtle animations to number changes
- [ ] Implement consistent loading skeletons
- [ ] Add hover effects to all interactive cards

---

## 💡 Usage Guidelines

### DO ✅
- Use semantic colors to convey financial meaning
- Apply hero cards to the single most important metric per page
- Group related metrics in semantic summary cards
- Use gradients and circles for visual depth
- Maintain hover effects on all interactive elements
- Use vibrant colors for charts and visualizations

### DON'T ❌
- Use flat monotone colors (gray/stone) for primary data
- Create multiple hero cards on the same page
- Mix inconsistent color schemes for the same data type
- Forget hover states on interactive cards
- Use default `var(--chart-1)` colors without semantic meaning
- Add too many decorative elements that clutter the UI

---

## 🎨 Quick Reference: Color Assignments

| Page | Hero Card | Positive Card | Warning Card | Danger Card |
|------|-----------|---------------|--------------|-------------|
| **Dashboard** | Monthly Spending (Dark gradient) | Income (Green) | - | Over Budget (Red) |
| **Budget** | Budget Remaining (Green) or Overspent (Red gradient) | Under Budget Categories (Green) | Near Limit (Amber) | Over Budget (Red) |
| **Wealth** | Net Worth (Dark gradient) ✅ | Assets (Green) ✅ | Liabilities (Amber) ✅ | - |
| **Analytics** | Period Total (Dark gradient) | Top Category (Category color) | - | - |

---

## 📝 Code Snippets

### Import Icons
```tsx
import { 
  TrendingUp, TrendingDown,   // For trends
  Wallet, CreditCard,          // For financial items
  Droplets, Percent,           // For metrics
} from "lucide-react";
```

### Color Helper
```tsx
const getSemanticColor = (type: 'positive' | 'warning' | 'danger') => ({
  positive: 'emerald',
  warning: 'amber',
  danger: 'rose',
}[type]);
```

---

**Last Updated**: 2026-01-05  
**Version**: 1.0.0
