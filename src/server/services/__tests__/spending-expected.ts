/**
 * What every spending reader shows for the spending fixture, derived by hand
 * from the table in spending-fixture.ts. Comments show each sum.
 */
// March: rent 300,000 + groceries 12,000 + USD 50 (50,000) + laptop part 40,000 + dinner share 20,000
const MARCH_TOTAL = 422_000;
// Every personal counted row (no shares): ARS 488,000 + USD 50 at 1,000
const LIFETIME = 538_000;

export const EXPECTED_READINGS = {
	lifetime: { totalSpent: LIFETIME, totalTransactions: 10 }, // 9 ARS + 1 USD rows
	spendingTotalMarch: MARCH_TOTAL,
	// Figure "spent": the running month (April) per currency, in minor units:
	// 1,000 + 5,000 + the laptop part 40,000, no shares in April
	spentFigure: [{ minor: 4_600_000, currency: "ARS" }],
	shares: [[20_000, "ARS", "2026-03-20T12:00:00.000Z"]],
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
	duplicateOfMoneyIn: { isDuplicate: false, existingTitle: null },
	titlesOfMoneyIn: [],
	// The probe is new to this ledger, so it imports.
	csvImport: { count: 1, skippedDuplicates: 0 },
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
