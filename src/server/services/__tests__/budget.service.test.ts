import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRateError } from "~/lib/money";
import { type TestExpenseRow, useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import {
	copyFromLastMonth,
	getBudgets,
	getSuggestions,
} from "../budget.service";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
	// spent() looks up hidden projects when a caller does not pass them.
	getExcludedProjectIds: async () => [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Rate table: ARS blue 1560 (preferred), EUR 0.8787.
const ARS = 1560;
const JUNE = new Date(2024, 5, 15);

function makeDbBudget(overrides: Record<string, unknown> = {}) {
	return {
		id: "budget-1",
		userId: "user-1",
		categoryId: "cat-1",
		amount: 500,
		currency: "USD",
		period: new Date(2024, 5, 1),
		type: "FIXED" as const,
		isRollover: false,
		rolloverAmount: 0,
		pegToActual: false,
		createdAt: new Date(2024, 0, 1),
		category: {
			id: "cat-1",
			name: "Food",
			color: "blue",
			icon: null,
			isFixed: false,
		},
		...overrides,
	};
}

function usd(date: Date, amount: number, extra: Partial<TestExpenseRow> = {}) {
	return {
		date,
		amount,
		currency: "USD",
		amountInUSD: amount,
		categoryId: "cat-1",
		...extra,
	};
}

function ars(
	date: Date,
	amount: number,
	rateAtTheTime: number,
	extra: Partial<TestExpenseRow> = {},
) {
	return {
		date,
		amount,
		currency: "ARS",
		amountInUSD: Math.round((amount / rateAtTheTime) * 100) / 100,
		categoryId: "cat-1",
		...extra,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BudgetService", () => {
	let db: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		useExpenseTable(db, []);
		mockGetSharedExpenseShares.mockResolvedValue([]);
	});

	// ── getBudgets ─────────────────────────────────────────────────────────────

	describe("getBudgets", () => {
		it("FIXED budget: effectiveAmount = budget.amount regardless of actual spend", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "FIXED", amount: 500 }),
			]);
			useExpenseTable(db, [usd(new Date(2024, 5, 3), 200)]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.effectiveAmount).toBe(500);
			expect(budget!.actualSpend).toBe(200);
		});

		it("PEG_TO_ACTUAL: effectiveAmount = actualSpend", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "PEG_TO_ACTUAL" }),
			]);
			useExpenseTable(db, [
				usd(new Date(2024, 5, 3), 150),
				usd(new Date(2024, 5, 4), 50),
			]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.effectiveAmount).toBe(200);
		});

		it("PEG_TO_ACTUAL via pegToActual=true legacy flag", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "FIXED", pegToActual: true }),
			]);
			useExpenseTable(db, [usd(new Date(2024, 5, 3), 120)]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.effectiveAmount).toBe(120);
		});

		it("PEG_TO_LAST_MONTH with current spend: last month's spending, shared included", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "PEG_TO_LAST_MONTH" }),
			]);
			useExpenseTable(db, [
				usd(new Date(2024, 5, 3), 100),
				usd(new Date(2024, 4, 10), 300),
			]);
			mockGetSharedExpenseShares.mockImplementation(
				async (_db: unknown, _u: unknown, range: { gte: Date }) =>
					range.gte.getMonth() === 4
						? [
								{
									amount: 40,
									currency: "USD",
									amountInUSD: 40,
									categoryId: "cat-1",
									date: new Date(2024, 4, 12),
								},
							]
						: [],
			);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.effectiveAmount).toBe(340);
			expect(budget!.actualSpend).toBe(100);
		});

		it("PEG_TO_LAST_MONTH with no spend yet: effectiveAmount = 0", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "PEG_TO_LAST_MONTH" }),
			]);
			useExpenseTable(db, [usd(new Date(2024, 4, 10), 300)]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.effectiveAmount).toBe(0);
		});

		it("ARS budget: ARS expenses count as entered, USD ones at the ARS rate", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ currency: "ARS", amount: 300000 }),
			]);
			useExpenseTable(db, [
				ars(new Date(2024, 5, 3), 100000, 1000),
				usd(new Date(2024, 5, 4), 10),
			]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.actualSpend).toBeCloseTo(100000 + 10 * ARS);
			expect(budget!.amountInUSD).toBeCloseTo(300000 / ARS);
		});

		it("home-currency fields: ARS home with a USD budget", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ amount: 500 })]);
			useExpenseTable(db, [
				ars(new Date(2024, 5, 3), 100000, 1000),
				usd(new Date(2024, 5, 4), 10),
			]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE, {
				homeCurrency: "ARS",
			});

			expect(budget!.amountInHome).toBeCloseTo(500 * ARS);
			expect(budget!.effectiveAmountInHome).toBeCloseTo(500 * ARS);
			expect(budget!.actualSpendInHome).toBeCloseTo(100000 + 10 * ARS);
			// In the budget's own currency: USD as entered, ARS from its stored USD
			expect(budget!.actualSpend).toBeCloseTo(10 + 100);
		});

		it("home-currency fields: USD home with an ARS budget", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ currency: "ARS", amount: 156000 }),
			]);
			useExpenseTable(db, [ars(new Date(2024, 5, 3), 15600, 1560)]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE, {
				homeCurrency: "USD",
			});

			expect(budget!.amountInHome).toBeCloseTo(100);
			expect(budget!.actualSpendInHome).toBeCloseTo(10);
		});

		it("a budget currency with no rate is an error, never 1:1", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ currency: "XYZ" })]);

			await expect(
				getBudgets(db as never, "user-1", JUNE),
			).rejects.toBeInstanceOf(MissingRateError);
		});

		it("shared expense shares count toward budget", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{
					amount: 75,
					currency: "USD",
					amountInUSD: 75,
					categoryId: "cat-1",
					date: new Date(2024, 5, 9),
				},
			]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE);

			expect(budget!.actualSpend).toBe(75);
		});

		it("fiscal month boundary: expenses outside range not counted", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			useExpenseTable(db, [
				usd(new Date(2024, 5, 14), 999), // before the 15th
				usd(new Date(2024, 5, 20), 30),
				usd(new Date(2024, 6, 14), 20),
			]);

			const [budget] = await getBudgets(db as never, "user-1", JUNE, {
				fiscalMonthStartDay: 15,
			});

			expect(budget!.actualSpend).toBe(50);
		});

		it("reads budget periods and expense dates in the user's time zone", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			// 22:30 on May 31 in Buenos Aires is June 1 in UTC.
			useExpenseTable(db, [usd(new Date("2024-06-01T01:30:00Z"), 60)]);
			const tz = "America/Argentina/Buenos_Aires";

			const [june] = await getBudgets(
				db as never,
				"user-1",
				new Date("2024-06-15T12:00:00Z"),
				{ timeZone: tz },
			);
			const [may] = await getBudgets(
				db as never,
				"user-1",
				new Date("2024-05-15T12:00:00Z"),
				{ timeZone: tz },
			);

			expect(june!.actualSpend).toBe(0);
			expect(may!.actualSpend).toBe(60);
			expect(db.budget.findMany.mock.calls[0]![0].where.period).toEqual({
				gte: new Date(2024, 5, 1),
				lt: new Date(2024, 6, 1),
			});
		});

		it("returns empty array when no budgets exist for the month", async () => {
			db.budget.findMany.mockResolvedValue([]);

			const result = await getBudgets(db as never, "user-1", JUNE);

			expect(result).toHaveLength(0);
		});
	});

	// ── getSuggestions ─────────────────────────────────────────────────────────

	describe("getSuggestions", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date(2024, 6, 10, 12)); // July 10
			db.category.findFirst.mockResolvedValue({
				id: "cat-1",
				userId: "user-1",
			});
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("throws FORBIDDEN if category not owned by user", async () => {
			db.category.findFirst.mockResolvedValue(null);

			await expect(
				getSuggestions(db as never, "user-1", "cat-999"),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("returns all zeros when no spending history", async () => {
			const result = await getSuggestions(db as never, "user-1", "cat-1");

			expect(result).toEqual({
				suggestedAmount: 0,
				averageSpend: 0,
				lastMonthSpend: 0,
			});
		});

		it("uses the 3 complete months before the running one", async () => {
			useExpenseTable(db, [
				usd(new Date(2024, 6, 2), 9999), // July: running month, ignored
				usd(new Date(2024, 5, 10), 100), // June
				usd(new Date(2024, 4, 10), 400), // May
				usd(new Date(2024, 3, 10), 200), // April
				usd(new Date(2024, 2, 10), 7777), // March: too old
			]);

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			expect(result).toEqual({
				suggestedAmount: 200,
				averageSpend: 233.33,
				lastMonthSpend: 100,
			});
		});

		it("follows the fiscal month: with start day 15 the running period is Jun 15 to Jul 14", async () => {
			useExpenseTable(db, [
				usd(new Date(2024, 5, 20), 9999), // running period, ignored
				usd(new Date(2024, 5, 10), 300), // May 15 to Jun 14
				usd(new Date(2024, 4, 1), 100), // Apr 15 to May 14
			]);

			const result = await getSuggestions(
				db as never,
				"user-1",
				"cat-1",
				"USD",
				15,
			);

			expect(result.lastMonthSpend).toBe(300);
			expect(result.averageSpend).toBe(200);
		});

		it("zero-spend months are excluded from the average", async () => {
			useExpenseTable(db, [
				usd(new Date(2024, 5, 10), 300),
				usd(new Date(2024, 3, 10), 100),
			]);

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			expect(result.averageSpend).toBe(200);
		});

		it("ARS suggestions keep ARS amounts as entered", async () => {
			useExpenseTable(db, [
				ars(new Date(2024, 5, 10), 120000, 1000),
				usd(new Date(2024, 5, 11), 10),
			]);

			const result = await getSuggestions(
				db as never,
				"user-1",
				"cat-1",
				"ARS",
			);

			expect(result.lastMonthSpend).toBe(120000 + 10 * ARS);
		});

		it("rounds to the currency's decimals", async () => {
			useExpenseTable(db, [
				usd(new Date(2024, 5, 10), 100.004),
				usd(new Date(2024, 4, 10), 200.006),
			]);

			const usdResult = await getSuggestions(db as never, "user-1", "cat-1");
			const jpyResult = await getSuggestions(
				db as never,
				"user-1",
				"cat-1",
				"JPY",
			);

			expect(usdResult.averageSpend).toBe(150.01);
			expect(Number.isInteger(jpyResult.averageSpend)).toBe(true);
		});
	});

	// ── copyFromLastMonth ──────────────────────────────────────────────────────

	describe("copyFromLastMonth", () => {
		it("throws CONFLICT if budgets already exist for target month", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);

			await expect(
				copyFromLastMonth(db as never, "user-1", new Date(2024, 5, 1)),
			).rejects.toMatchObject({ code: "CONFLICT" });
		});

		it("throws NOT_FOUND if no earlier month has budgets", async () => {
			db.budget.findMany.mockResolvedValue([]);
			db.budget.groupBy.mockResolvedValue([]);

			await expect(
				copyFromLastMonth(db as never, "user-1", new Date(2024, 5, 1)),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("copies amount, currency and settings from the most recent earlier month", async () => {
			db.budget.findMany
				.mockResolvedValueOnce([]) // no existing budgets in target month
				.mockResolvedValueOnce([
					makeDbBudget({
						period: new Date(2024, 4, 1),
						currency: "ARS",
						amount: 250000,
						type: "PEG_TO_LAST_MONTH",
					}),
				]);
			db.budget.groupBy.mockResolvedValue([
				{ period: new Date(2024, 4, 1), _count: { period: 1 } },
			]);
			db.budget.create.mockImplementation(async (args: { data: object }) => ({
				...makeDbBudget(),
				...args.data,
			}));

			const result = await copyFromLastMonth(
				db as never,
				"user-1",
				new Date(2024, 5, 1),
			);

			expect(db.budget.groupBy.mock.calls[0]![0].where.period).toEqual({
				lt: new Date(2024, 5, 1),
			});
			expect(db.budget.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						userId: "user-1",
						currency: "ARS",
						amount: 250000,
						type: "PEG_TO_LAST_MONTH",
						period: new Date(2024, 5, 1),
					}),
				}),
			);
			expect(result).toHaveLength(1);
		});
	});
});
