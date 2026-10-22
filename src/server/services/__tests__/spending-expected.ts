/**
 * What every spending reader shows for the spending fixture, derived by hand
 * from the table in spending-fixture.ts. Comments show each sum.
 */
// March: rent 300,000 + groceries 12,000 + USD 50 (50,000) + laptop part 40,000 + dinner share 20,000
const MARCH_TOTAL = 422_000;
// February: groceries 20,000 + laptop part 40,000; January: groceries 30,000
const FEB_TOTAL = 60_000;
// Every personal counted row (no shares): ARS 488,000 + USD 50 at 1,000
const LIFETIME = 538_000;

const SUMMARY = {
	totalThisMonth: MARCH_TOTAL,
	changeVsLastMonth: ((MARCH_TOTAL - FEB_TOTAL) / FEB_TOTAL) * 100,
	dailyAverage: MARCH_TOTAL / 31,
	// mean of the earlier months that had spending: (60,000 + 30,000) / 2
	projectedSpend: 45_000,
};

const BREAKDOWN = [
	["Rent", 300_000],
	["Groceries", 62_000], // 12,000 + 50,000
	["Uncategorized", 60_000], // laptop part + Bob's dinner (his category)
];

export const EXPECTED_READINGS = {
	summary: SUMMARY,
	breakdown: BREAKDOWN,
	lifetime: { totalSpent: LIFETIME, totalTransactions: 10 }, // 9 ARS + 1 USD rows
	overviewMarch: {
		last24Hours: 0,
		isCurrentMonth: false,
		monthTotal: MARCH_TOTAL,
		dailyBudgetPace: {
			totalBudget: 400_000, // rent 300,000 (fixed) + groceries 100,000
			totalSpent: 362_000, // in budgeted categories: 300,000 + 62,000
			variableBudget: 100_000,
			variableSpent: 62_000,
			daysRemaining: 0,
		},
		// USD 1,000 monthly income at 1,000
		workEquivalent: { totalSpent: MARCH_TOTAL, monthlyIncome: 1_000_000 },
	},
	overviewApril: {
		// kiosk 5,000 today, plus the Apr 15 laptop part: the window has no upper bound
		last24Hours: 45_000,
		isCurrentMonth: true,
		monthTotal: 46_000, // 1,000 + 5,000 + 40,000
		dailyBudgetPace: {
			totalBudget: 0,
			totalSpent: 0,
			variableBudget: 0,
			variableSpent: 0,
			daysRemaining: 21, // Apr 10 to Apr 30
		},
		workEquivalent: { totalSpent: 46_000, monthlyIncome: 1_000_000 },
	},
	budgets: [
		["Groceries", 62_000, 62_000],
		["Rent", 300_000, 300_000],
	],
	// Groceries in Jan, Feb, Mar (personal only): 30,000, 20,000, 62,000
	suggestions: {
		suggestedAmount: 30_000, // median
		averageSpend: 37_333.33, // 112,000 / 3
		lastMonthSpend: 62_000,
	},
	spendingTotalMarch: MARCH_TOTAL,
	// Figure "spent": the running month (April) per currency, in minor units:
	// 1,000 + 5,000 + the laptop part 40,000, no shares in April
	spentFigure: [{ minor: 4_600_000, currency: "ARS" }],
	shares: [[20_000, "ARS", "2026-03-20T12:00:00.000Z"]],
	dashboard: {
		hasExpenses: true,
		monthTotal: MARCH_TOTAL,
		summary: SUMMARY,
		categories: BREAKDOWN,
		trendEnd: {
			day: "Mar 31",
			dateLabel: "Mar 31, 2026",
			value: MARCH_TOTAL,
			total: MARCH_TOTAL,
			fixed: 300_000,
			variable: 122_000,
		},
	},
	statsSummary: SUMMARY,
	statsLifetime: { totalSpent: LIFETIME, totalTransactions: 10 },
	// 12 finalized rows: 7 plain, the hidden one, the laptop and its 3 parts
	profileLifetime: { lifetimeSpend: LIFETIME, totalEntries: 12 },
	runway: {
		// Oct 10 to now: 538,000 - the future laptop part 40,000 + dinner 20,000,
		// over 80 days since Jan 20 in months of 30.436875 days
		averageMonthlySpend: 518_000 / (80 / 30.436875),
		monthsActive: 3,
	},
	byDate: [["Super Mar", 12_000, "ARS", "2026-03-05T12:00:00.000Z"]],
	duplicate: { isDuplicate: true, existingTitle: "Super Mar" },
	titles: [
		["Super Apr", 1, 1_000],
		["Super Feb", 1, 20_000],
		["Super Jan", 1, 30_000],
		["Super Mar", 1, 12_000],
	],
	csvLines: 10, // header + the 9 finalized rows that are not amortized parts
	categories: ["Groceries", "Rent"],
};

/** Finalized rows that are not amortized parts, newest first (lists and Recent). */
export const EXPECTED_LISTED = [
	["Kiosk", 5_000, "ARS", "2026-04-10T02:00:00.000Z"],
	["Super Apr", 1_000, "ARS", "2026-04-05T12:00:00.000Z"],
	["Hidden", 7_000, "ARS", "2026-03-12T12:00:00.000Z"],
	["Imported snacks", 50, "USD", "2026-03-10T12:00:00.000Z"],
	["Super Mar", 12_000, "ARS", "2026-03-05T12:00:00.000Z"],
	["Rent March", 300_000, "ARS", "2026-03-01T12:00:00.000Z"],
	["Laptop", 120_000, "ARS", "2026-02-15T12:00:00.000Z"],
	["Super Feb", 20_000, "ARS", "2026-02-03T12:00:00.000Z"],
	["Super Jan", 30_000, "ARS", "2026-01-20T12:00:00.000Z"],
];

/** The Recent feed lists shares too, rejected ones included, but not hidden projects. */
export const EXPECTED_RECENT = [
	["personal", "Kiosk", 5_000, "ARS"],
	["personal", "Super Apr", 1_000, "ARS"],
	["shared", "Rejected taxi", 4_000, "ARS"],
	["shared", "Dinner", 20_000, "ARS"],
	["personal", "Hidden", 7_000, "ARS"],
	["personal", "Imported snacks", 50, "USD"],
	["personal", "Super Mar", 12_000, "ARS"],
	["personal", "Rent March", 300_000, "ARS"],
	["personal", "Laptop", 120_000, "ARS"],
	["personal", "Super Feb", 20_000, "ARS"],
	["personal", "Super Jan", 30_000, "ARS"],
];

/** Cumulative March trend on the days something was spent: [day, total, fixed, variable]. */
export const TREND_STEPS: Record<string, [number, number, number]> = {
	"Mar 1": [300_000, 300_000, 0],
	"Mar 5": [312_000, 300_000, 12_000],
	"Mar 10": [362_000, 300_000, 62_000],
	"Mar 15": [402_000, 300_000, 102_000],
	"Mar 20": [422_000, 300_000, 122_000],
	"Mar 31": [422_000, 300_000, 122_000],
};
