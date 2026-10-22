/**
 * The money-in leak test (IMPLEMENTATION §7.2, risk §10 row 1): money in sits
 * in the expense table next to spending, so every reader of spending is run
 * for users who have the characterization ledger plus money in, and compared
 * with a user who has the ledger alone.
 *
 * - Income, own transfers (NOT_SPENDING), starting balances and adjustments
 *   change no reader at all: no total, list, count, duplicate check or title
 *   suggestion.
 * - A refund nets against spending in its category and month (D27), and no
 *   list shows it until the Activity rebuild labels money in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureIncomeCategories } from "~/server/services/expense.service";
import { adminDb } from "~/test/pg-harness";
import {
	EXPECTED_LISTED,
	EXPECTED_READINGS,
	EXPECTED_RECENT,
} from "./spending-expected";
import {
	at,
	expenseData,
	NOW,
	type Row,
	type SpendingFixture,
	seedSpendingFixture,
} from "./spending-fixture";
import { readAllSpendingReaders } from "./spending-readers";

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

type Readings = Awaited<ReturnType<typeof readAllSpendingReaders>>;

async function addRows(fixture: SpendingFixture, rows: Row[]) {
	await adminDb.expense.createMany({
		data: rows.map((row) => expenseData(fixture.userId, row)),
	});
}

/** Money in of every kind, dated inside the ledger's months and shaped to trip each reader. */
async function addMoneyIn(fixture: SpendingFixture) {
	const income = await ensureIncomeCategories(adminDb, fixture.userId);
	const salary = income.find((c) => c.name === "Salary")?.id;
	const gifts = income.find((c) => c.name === "Gifts")?.id;
	await addRows(fixture, [
		{
			title: "Salary",
			amount: 1_000_000,
			date: at("2026-03-01"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// Inside the dashboard's last 24 hours.
		{
			title: "Salary",
			amount: 1_000_000,
			date: new Date("2026-04-10T06:00:00.000Z"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// Same title, amount and day as an expense: duplicate checks and title suggestions must not see it.
		{
			title: "Super Mar",
			amount: 12_000,
			date: at("2026-03-05"),
			categoryId: gifts,
			direction: "IN",
			inType: "INCOME",
		},
		{
			title: "Upwork",
			amount: 100,
			currency: "USD",
			date: at("2026-03-20"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// An own transfer out, in a spending category, and its matching transfer in.
		{
			title: "Super card payment",
			amount: 50_000,
			date: at("2026-03-10"),
			categoryId: fixture.groceries.id,
			entryKind: "NOT_SPENDING",
		},
		{
			title: "From savings",
			amount: 50_000,
			date: at("2026-03-10"),
			direction: "IN",
			entryKind: "NOT_SPENDING",
		},
		{
			title: "Starting money",
			amount: 500_000,
			date: at("2026-01-01"),
			direction: "IN",
			entryKind: "STARTING_BALANCE",
		},
		{
			title: "Reconcile up",
			amount: 3_000,
			date: at("2026-03-15"),
			direction: "IN",
			entryKind: "ADJUSTMENT",
		},
		{
			title: "Reconcile down",
			amount: 4_000,
			date: at("2026-03-16"),
			entryKind: "ADJUSTMENT",
		},
	]);
}

describe("money in never reaches a spending reader", () => {
	let plain: Readings;
	let withMoneyIn: Readings;
	let withRefund: Readings;

	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		const [a, b, c] = [
			await seedSpendingFixture(),
			await seedSpendingFixture(),
			await seedSpendingFixture(),
		];
		await addMoneyIn(b);
		await addRows(c, [
			{
				title: "Returned jacket",
				amount: 1_500,
				date: at("2026-03-25"),
				categoryId: c.groceries.id,
				direction: "IN",
				inType: "REFUND",
			},
			// Hidden from reports: reports skip it like a hidden expense.
			{
				title: "Hidden refund",
				amount: 1_000,
				date: at("2026-03-26"),
				categoryId: c.groceries.id,
				direction: "IN",
				inType: "REFUND",
				excludeFromAnalytics: true,
			},
		]);
		plain = await readAllSpendingReaders(a);
		withMoneyIn = await readAllSpendingReaders(b);
		withRefund = await readAllSpendingReaders(c);
	}, 120_000);
	afterAll(() => vi.useRealTimers());

	it("starts from the characterized numbers", () => {
		expect(plain).toMatchObject(EXPECTED_READINGS);
	});

	for (const reader of Object.keys(EXPECTED_READINGS).concat(
		"trend",
		"listed",
		"recent",
	)) {
		if (reader === "categories") continue;
		it(`leaves ${reader} unchanged with income, transfers and adjustments`, () => {
			expect(withMoneyIn[reader as keyof Readings]).toEqual(
				plain[reader as keyof Readings],
			);
		});
	}

	it("adds only the income categories to the category list", () => {
		// Pickers filter by kind once the money-in screens land (2D/S4).
		expect([...withMoneyIn.categories].sort()).toEqual(
			[
				...plain.categories,
				"Freelance",
				"Gifts",
				"Interest",
				"Other income",
				"Salary",
				"Sales",
			].sort(),
		);
	});

	describe("a refund", () => {
		// March spending 422,000 less the 1,500 Groceries refund.
		const MARCH = 420_500;
		const summary = {
			totalThisMonth: MARCH,
			changeVsLastMonth: ((MARCH - 60_000) / 60_000) * 100,
			dailyAverage: MARCH / 31,
			projectedSpend: 45_000,
		};
		const breakdown = [
			["Rent", 300_000],
			["Groceries", 60_500],
			["Uncategorized", 60_000],
		];

		it("nets against spending in its month and category", () => {
			expect(withRefund).toMatchObject({
				summary,
				breakdown,
				statsSummary: summary,
				spendingTotalMarch: MARCH,
				budgets: [
					["Groceries", 60_500, 60_500],
					["Rent", 300_000, 300_000],
				],
				overviewMarch: {
					monthTotal: MARCH,
					dailyBudgetPace: { totalSpent: 360_500, variableSpent: 60_500 },
					workEquivalent: { totalSpent: MARCH },
				},
				dashboard: { monthTotal: MARCH, summary, categories: breakdown },
				// Groceries by month: 30,000, 20,000, 60,500
				suggestions: {
					suggestedAmount: 30_000,
					averageSpend: 36_833.33,
					lastMonthSpend: 60_500,
				},
				// The refund lowers the total but is not a transaction, as in totalEntries.
				lifetime: { totalSpent: 536_500, totalTransactions: 10 },
				profileLifetime: { lifetimeSpend: 536_500, totalEntries: 12 },
				runway: {
					averageMonthlySpend: 516_500 / (80 / 30.436875),
					monthsActive: 3,
				},
				// April, the running month, has no refund.
				spentFigure: EXPECTED_READINGS.spentFigure,
			});
		});

		it("lowers the trend from its own day", () => {
			const day = (label: string) =>
				withRefund.trend.find((d) => d[0] === label);
			expect(day("Mar 24")).toEqual(["Mar 24", 422_000, 300_000, 122_000]);
			expect(day("Mar 25")).toEqual(["Mar 25", MARCH, 300_000, 120_500]);
		});

		it("is not listed by the screens that cannot label it yet", () => {
			expect(withRefund.listed).toEqual(EXPECTED_LISTED);
			expect(withRefund.recent).toEqual(EXPECTED_RECENT);
			expect(withRefund.csvLines).toBe(EXPECTED_READINGS.csvLines);
		});
	});
});
