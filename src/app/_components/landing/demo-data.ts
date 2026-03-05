import type { CategorySegment } from "~/app/app/(dashboard)/_components/category-donut-legend";
import type { NormalizedExpense } from "~/lib/normalize";
import { AssetType } from "~/lib/db-enums";
import type { Asset } from "~/components/wealth/wealth-table-columns";

// -- StatCards --
export const DEMO_STAT_CARDS = {
	totalThisMonth: 3247.82,
	dailyAverage: 108.26,
	projectedSpend: 3789.12,
	changeVsLastMonth: -12.4,
};

// -- BudgetPacingChart --
// Daily variable spend amounts (each day adds to cumulative total)
const _DAILY_VAR_SPEND = [68, 94, 41, 112, 83, 55, 120, 38, 76, 145, 62, 98, 44, 87, 110];
export const DEMO_DAILY_TREND = _DAILY_VAR_SPEND.reduce(
	(acc, dailySpend, i) => {
		const prev = acc[i - 1];
		const cumulativeVariable = (prev?.variable ?? 0) + dailySpend;
		const cumulativeFixed = (i + 1) * 22;
		const total = cumulativeVariable + cumulativeFixed;
		acc.push({
			day: String(i + 1),
			dateLabel: `Mar ${i + 1}`,
			value: total,
			total,
			fixed: cumulativeFixed,
			variable: cumulativeVariable,
		});
		return acc;
	},
	[] as { day: string; dateLabel: string; value: number; total: number; fixed: number; variable: number }[],
);

export const DEMO_CHART_CONFIG = {
	variable: { label: "Variable Spend", color: "hsl(160, 84%, 39%)" },
	guide: { label: "Ideal Pace", color: "#525252" },
};

// -- CategoryDonut --
const DEMO_CATEGORIES_RAW = [
	{ name: "Groceries", value: 842, color: "#059669", key: "groceries", id: "1" },
	{ name: "Dining Out", value: 524, color: "#ea580c", key: "dining", id: "2" },
	{ name: "Transport", value: 398, color: "#2563eb", key: "transport", id: "3" },
	{ name: "Entertainment", value: 312, color: "#7c3aed", key: "entertainment", id: "4" },
	{ name: "Utilities", value: 267, color: "#0891b2", key: "utilities", id: "5" },
	{ name: "Shopping", value: 489, color: "#ec4899", key: "shopping", id: "6" },
	{ name: "Health", value: 215, color: "#f59e0b", key: "health", id: "7" },
];

export const DEMO_CATEGORY_BREAKDOWN: CategorySegment[] = DEMO_CATEGORIES_RAW.map(
	(c) => ({
		key: c.key,
		name: c.name,
		value: c.value,
		color: c.color,
		categoryColor: c.color,
		categoryId: c.id,
	}),
);

export const DEMO_PIE_CHART_CONFIG = Object.fromEntries(
	DEMO_CATEGORIES_RAW.map((c) => [c.key, { label: c.name, color: c.color }]),
);

// -- RecentExpenses --
export const DEMO_RECENT_EXPENSES: NormalizedExpense[] = [
	{
		id: "demo-1",
		title: "Whole Foods Market",
		amount: 87.43,
		currency: "USD",
		exchangeRate: null,
		amountInUSD: 87.43,
		date: new Date(2026, 2, 14),
		location: null,
		description: null,
		categoryId: "1",
		category: { id: "1", name: "Groceries", color: "emerald", icon: null },
	},
	{
		id: "demo-2",
		title: "Uber",
		amount: 24.5,
		currency: "USD",
		exchangeRate: null,
		amountInUSD: 24.5,
		date: new Date(2026, 2, 13),
		location: null,
		description: null,
		categoryId: "3",
		category: { id: "3", name: "Transport", color: "blue", icon: null },
	},
	{
		id: "demo-3",
		title: "Netflix",
		amount: 15.99,
		currency: "USD",
		exchangeRate: null,
		amountInUSD: 15.99,
		date: new Date(2026, 2, 12),
		location: null,
		description: null,
		categoryId: "4",
		category: { id: "4", name: "Entertainment", color: "violet", icon: null },
	},
	{
		id: "demo-4",
		title: "Starbucks",
		amount: 6.75,
		currency: "USD",
		exchangeRate: null,
		amountInUSD: 6.75,
		date: new Date(2026, 2, 12),
		location: null,
		description: null,
		categoryId: "2",
		category: { id: "2", name: "Dining Out", color: "orange", icon: null },
	},
	{
		id: "demo-5",
		title: "Amazon",
		amount: 142.0,
		currency: "USD",
		exchangeRate: null,
		amountInUSD: 142.0,
		date: new Date(2026, 2, 11),
		location: null,
		description: null,
		categoryId: "6",
		category: { id: "6", name: "Shopping", color: "pink", icon: null },
	},
];

// -- Budget / PartitionBar --
export const DEMO_CATEGORY_BUDGETS = [
	{ id: "b1", name: "Groceries",     color: "emerald", allocatedAmount: 900, actualSpend: 842, pegToActual: false }, // 94% — nearly over
	{ id: "b2", name: "Dining Out",    color: "orange",  allocatedAmount: 500, actualSpend: 524, pegToActual: false }, // 105% — over budget
	{ id: "b3", name: "Transport",     color: "blue",    allocatedAmount: 400, actualSpend: 188, pegToActual: false }, // 47% — well under
	{ id: "b4", name: "Entertainment", color: "violet",  allocatedAmount: 350, actualSpend: 95,  pegToActual: false }, // 27% — barely spent
	{ id: "b5", name: "Utilities",     color: "cyan",    allocatedAmount: 300, actualSpend: 267, pegToActual: true  }, // pegged
	{ id: "b6", name: "Shopping",      color: "pink",    allocatedAmount: 500, actualSpend: 341, pegToActual: false }, // 68% — on track
	{ id: "b7", name: "Health",        color: "amber",   allocatedAmount: 250, actualSpend: 215, pegToActual: false }, // 86% — getting close
];

// -- Wealth --
export const DEMO_WEALTH_ALLOCATION = [
	{ type: "stocks", label: "Stocks & ETFs", value: 85400, percentage: 48.2, fill: "#2563eb" },
	{ type: "savings", label: "Savings", value: 42800, percentage: 24.2, fill: "#059669" },
	{ type: "crypto", label: "Crypto", value: 28600, percentage: 16.2, fill: "#7c3aed" },
	{ type: "property", label: "Property", value: 20200, percentage: 11.4, fill: "#ea580c" },
];

export const DEMO_NET_WORTH = {
	totalNetWorth: 177000,
	totalAssets: 192400,
	totalLiabilities: 15400,
	totalLiquidAssets: 128200,
	weightedAPR: 4.2,
	averageMonthlySpend: 3248,
	netWorth30DaysAgo: 172500,
};

export const DEMO_WEALTH_ASSETS: Asset[] = [
	{
		id: "w1",
		name: "Vanguard S&P 500",
		type: AssetType.INVESTMENT,
		currency: "USD",
		balance: 65400,
		balanceInUSD: 65400,
		balanceInTargetCurrency: 65400,
		isLiquid: true,
	},
	{
		id: "w2",
		name: "High-Yield Savings",
		type: AssetType.CASH,
		currency: "USD",
		balance: 42800,
		balanceInUSD: 42800,
		balanceInTargetCurrency: 42800,
		isLiquid: true,
		interestRate: 4.5,
	},
	{
		id: "w3",
		name: "Bitcoin Vault",
		type: AssetType.CRYPTO,
		currency: "BTC",
		balance: 0.45,
		balanceInUSD: 28600,
		balanceInTargetCurrency: 28600,
		isLiquid: true,
	},
	{
		id: "w4",
		name: "Investment Property",
		type: AssetType.REAL_ESTATE,
		currency: "USD",
		balance: 20200,
		balanceInUSD: 20200,
		balanceInTargetCurrency: 20200,
		isLiquid: false,
	},
	{
		id: "w5",
		name: "Fidelity 401k",
		type: AssetType.INVESTMENT,
		currency: "USD",
		balance: 20000,
		balanceInUSD: 20000,
		balanceInTargetCurrency: 20000,
		isLiquid: false,
	},
	{
		id: "w6",
		name: "Chase Checking",
		type: AssetType.CASH,
		currency: "USD",
		balance: 15400,
		balanceInUSD: 15400,
		balanceInTargetCurrency: 15400,
		isLiquid: true,
	},
	{
		id: "w7",
		name: "C6 Bank",
		type: AssetType.CASH,
		currency: "BRL",
		balance: 12500,
		balanceInUSD: 2380,
		balanceInTargetCurrency: 2380,
		isLiquid: true,
	},
	{
		id: "l1",
		name: "Auto Loan",
		type: "LIABILITY_LOAN" as AssetType,
		currency: "USD",
		balance: -15400,
		balanceInUSD: -15400,
		balanceInTargetCurrency: -15400,
		isLiquid: false,
		interestRate: 4.2,
	}
];

// -- Wealth History --
// Seeded PRNG (mulberry32) for deterministic data across server/client
function seededRandom(seed: number) {
	let s = seed;
	return () => {
		s |= 0;
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function generateDemoWealthHistory() {
	const rand = seededRandom(1234);
	const data: Array<{ date: string; amount: number; assets: number; liabilities: number }> = [];
	const end = new Date(2026, 2, 4); // Mar 4, 2026
	
	const startAssets = 140000;
	const endAssets = DEMO_NET_WORTH.totalAssets;
	const startLiabilities = 25000;
	const endLiabilities = DEMO_NET_WORTH.totalLiabilities;
	
	for (let i = 365; i >= 0; i--) {
		const d = new Date(end);
		d.setDate(d.getDate() - i);
		
		const progress = (365 - i) / 365; // 0 to 1
		
		// Interpolate base values
		let currentAssets = startAssets + (endAssets - startAssets) * progress;
		let currentLiabilities = startLiabilities + (endLiabilities - startLiabilities) * progress;
		
		// Add some market cycle simulation (sine waves) plus daily volatility for assets
		const marketCycle = Math.sin(progress * Math.PI * 5) * 8000 + Math.cos(progress * Math.PI * 12) * 3000;
		const dailyVolatility = (rand() * 2400) - 1200;
		// Occasional big swings
		const bigSwing = rand() > 0.95 ? (rand() * 10000) - 5000 : 0;
		
		// Smoothly reduce noise at the very end so it converges cleanly
		const noiseMultiplier = i < 15 ? i / 15 : 1;
		
		currentAssets += (marketCycle + dailyVolatility + bigSwing) * noiseMultiplier;
		
		// Small daily noise for liabilities
		currentLiabilities += ((rand() * 300) - 150) * noiseMultiplier;
		if (currentLiabilities < 0) currentLiabilities = 0;
		
		data.push({
			date: d.toISOString().split("T")[0] as string,
			amount: currentAssets - currentLiabilities,
			assets: currentAssets,
			liabilities: currentLiabilities,
		});
	}
	
	// Force the last item to match the net worth summary exact totals
	const last = data[data.length - 1];
	if (last) {
		last.assets = DEMO_NET_WORTH.totalAssets;
		last.liabilities = DEMO_NET_WORTH.totalLiabilities;
		last.amount = DEMO_NET_WORTH.totalNetWorth;
	}
	
	return data;
}
