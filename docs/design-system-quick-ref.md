# Design System Quick Reference

## Color Palette

### Financial Status Colors

```tsx
// Positive, Assets, Income, Growth
emerald: "hsl(160, 84%, 39%)"

// Warning, Liabilities, Caution  
amber: "hsl(38, 92%, 50%)"

// Investments, Savings, Primary
blue: "hsl(217, 91%, 60%)"

// Crypto, Alternative Assets
violet: "hsl(263, 70%, 50%)"

// Negative, Overspending, Losses
rose: "hsl(0, 84%, 60%)"

// Neutral Activity, Transactions
cyan: "hsl(190, 84%, 50%)"

// Other, Miscellaneous
orange: "hsl(25, 95%, 53%)"
```

## Component Patterns

### 1. Hero Card (Dark Gradient)
**Example**: Wealth Dashboard - Total Net Worth

Key features:
- Full-width dark gradient background
- Large 4xl/5xl font size for main value
- Decorative background circles (white/5 opacity)
- Trend badge with icon and percentage
- Secondary info in pill/badge format

### 2. Semantic Summary Card (Colored)
**Examples**: 
- Assets card (green theme)
- Liabilities card (amber theme)

Key features:
- Colored gradient background (from-{color}-50 to-white)
- Colored border (border-{color}-200/50)
- Hover shadow with matching color
- Animated background circle on hover
- Icon in colored badge (bg-{color}-100)
- Color-coded text (text-{color}-700)

### 3. Chart Colors
**Wealth Allocation**: Distinct vibrant colors per asset type
**Currency Bars**: Rainbow palette for variety
**Trend Lines**: Blue with gradient fill

## Page-by-Page Application

| Page | Hero Content | Secondary Cards | Colors |
|------|--------------|-----------------|--------|
| Dashboard | Total Monthly Spending | Income (green), Categories (varied) | Blue, Emerald, Category colors |
| Budget | Remaining/Overspent | Category budgets | Green/Red gradient, Category colors |
| Wealth ✅ | Net Worth | Assets (green), Liabilities (amber) | Dark gradient, Emerald, Amber |
| Analytics | Period Total | Top categories | Dark gradient, Category colors |

## Implementation Checklist

### Next Priority Pages:
1. **Dashboard** - Add hero spending card, semantic income/expense cards
2. **Budget** - Add hero budget status, colorize category cards  
3. **Analytics** - Add hero period total, semantic top category cards

### Consistency Rules:
- ✅ Always use semantic colors (green=positive, amber=warning, red=danger)
- ✅ One hero card per page maximum
- ✅ Hover effects on all cards (shadow-lg with matching color)
- ✅ Decorative circles on premium cards
- ✅ Vibrant chart colors (no monotone grays)
- ❌ Never use flat default colors for primary metrics
- ❌ Never create more than one hero card per view
