import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import {
	copyFromLastMonth,
	getBudgets,
	getGlobalBudget,
	getSuggestions,
} from "../budget.service";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetBestExchangeRate = vi.hoisted(() => vi.fn());
const mockSumExpensesForCurrency = vi.hoisted(() => vi.fn());
const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());

vi.mock("~/server/api/routers/shared-currency", () => ({
	getBestExchangeRate: mockGetBestExchangeRate,
	sumExpensesForCurrency: mockSumExpensesForCurrency,
}));

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDbBudget(overrides: Record<string, unknown> = {}) {
	return {
		id: "budget-1",
		userId: "user-1",
		categoryId: "cat-1",
		amount: 500,
		currency: "USD",
		period: new Date("2024-06-01"),
		type: "FIXED" as const,
		isRollover: false,
		rolloverAmount: 0,
		pegToActual: false,
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

function makeExpenseRow(overrides: Record<string, unknown> = {}) {
	return {
		amount: 100,
		currency: "USD",
		amountInUSD: 100,
		categoryId: "cat-1",
		...overrides,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BudgetService", () => {
	let db: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();

		mockGetBestExchangeRate.mockResolvedValue({ rate: 1, type: "official" });
		mockGetSharedExpenseShares.mockResolvedValue([]);
		mockSumExpensesForCurrency.mockResolvedValue({ total: 0, totalInUSD: 0 });
	});

	// ── getBudgets ─────────────────────────────────────────────────────────────

	describe("getBudgets", () => {
		it("FIXED budget: effectiveAmount = budget.amount regardless of actual spend", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ type: "FIXED", amount: 500 })]);
			db.expense.findMany.mockResolvedValue([makeExpenseRow({ amount: 200, amountInUSD: 200 })]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.effectiveAmount).toBe(500);
			expect(result[0]!.actualSpend).toBe(200);
		});

		it("PEG_TO_ACTUAL: effectiveAmount = actualSpend", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ type: "PEG_TO_ACTUAL", amount: 500 })]);
			db.expense.findMany.mockResolvedValue([
				makeExpenseRow({ amount: 150, amountInUSD: 150 }),
				makeExpenseRow({ amount: 50, amountInUSD: 50 }),
			]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.effectiveAmount).toBe(200);
		});

		it("PEG_TO_ACTUAL via pegToActual=true legacy flag: effectiveAmount = actualSpend", async () => {
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ type: "FIXED", pegToActual: true, amount: 500 }),
			]);
			db.expense.findMany.mockResolvedValue([makeExpenseRow({ amount: 120, amountInUSD: 120 })]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.effectiveAmount).toBe(120);
		});

		it("PEG_TO_LAST_MONTH with current spend > 0: effectiveAmount = last month's spend", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ type: "PEG_TO_LAST_MONTH" })]);
			// First findMany call: current month expenses
			// Second findMany call (last month): fetched because hasPegToLastMonth
			db.expense.findMany
				.mockResolvedValueOnce([makeExpenseRow({ amount: 100, amountInUSD: 100 })]) // current
				.mockResolvedValueOnce([makeExpenseRow({ amount: 300, amountInUSD: 300 })]); // last month

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.effectiveAmount).toBe(300);
			expect(result[0]!.actualSpend).toBe(100);
		});

		it("PEG_TO_LAST_MONTH with current spend = 0: effectiveAmount = 0 (not last month's value)", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ type: "PEG_TO_LAST_MONTH" })]);
			db.expense.findMany
				.mockResolvedValueOnce([]) // current month: no spend
				.mockResolvedValueOnce([makeExpenseRow({ amount: 300, amountInUSD: 300 })]); // last month

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.effectiveAmount).toBe(0);
		});

		it("empty month: all budgets show 0 actualSpend", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			db.expense.findMany.mockResolvedValue([]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.actualSpend).toBe(0);
			expect(result[0]!.actualSpendInUSD).toBe(0);
		});

		it("cross-currency expense: converts via USD to budget currency", async () => {
			// Budget in ARS, expense in USD - rate: 1000 ARS/USD
			mockGetBestExchangeRate.mockResolvedValue({ rate: 1000, type: "blue" });
			db.budget.findMany.mockResolvedValue([
				makeDbBudget({ currency: "ARS", amount: 100000 }),
			]);
			// expense in USD: 50 USD = 50,000 ARS @ 1000 ARS/USD
			db.expense.findMany.mockResolvedValue([
				makeExpenseRow({ amount: 50, currency: "USD", amountInUSD: 50 }),
			]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			// fromUSD(50, "ARS", 1000) = 50 * 1000 = 50000
			expect(result[0]!.actualSpend).toBeCloseTo(50000);
		});

		it("same-currency expense: uses original amount directly", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget({ currency: "USD" })]);
			db.expense.findMany.mockResolvedValue([
				makeExpenseRow({ amount: 75, currency: "USD", amountInUSD: 75 }),
			]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.actualSpend).toBe(75);
		});

		it("shared expense shares count toward budget", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			db.expense.findMany.mockResolvedValue([makeExpenseRow({ amount: 100, amountInUSD: 100 })]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{ amount: 50, currency: "USD", amountInUSD: 50, categoryId: "cat-1", date: new Date() },
			]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result[0]!.actualSpend).toBe(150); // 100 personal + 50 shared
		});

		it("fiscal month boundary: expenses outside range not counted", async () => {
			// startDay=15: fiscal month for June 2024 is Jun 15 – Jul 14
			// We can verify the fiscal boundary is passed correctly to expense query
			db.budget.findMany.mockResolvedValue([makeDbBudget()]);
			db.expense.findMany.mockResolvedValue([]);

			await getBudgets(db as never, "user-1", new Date("2024-06-20"), { fiscalMonthStartDay: 15 });

			const expenseQuery = db.expense.findMany.mock.calls[0]![0] as {
				where: { date: { gte: Date; lte: Date } };
			};
			expect(expenseQuery.where.date.gte.getDate()).toBe(15);
		});

		it("returns empty array when no budgets exist for the month", async () => {
			db.budget.findMany.mockResolvedValue([]);

			const result = await getBudgets(db as never, "user-1", new Date("2024-06-15"));

			expect(result).toHaveLength(0);
		});
	});

	// ── getGlobalBudget ────────────────────────────────────────────────────────

	describe("getGlobalBudget", () => {
		it("returns null when no global budget exists", async () => {
			db.budget.findFirst.mockResolvedValue(null);

			const result = await getGlobalBudget(db as never, "user-1", new Date("2024-06-15"));

			expect(result).toBeNull();
		});

		it("returns global budget with actualSpend from sumExpensesForCurrency", async () => {
			db.budget.findFirst.mockResolvedValue(
				makeDbBudget({ categoryId: null, amount: 2000, currency: "USD" }),
			);
			mockSumExpensesForCurrency.mockResolvedValue({ total: 450, totalInUSD: 450 });

			const result = await getGlobalBudget(db as never, "user-1", new Date("2024-06-15"));

			expect(result).not.toBeNull();
			expect(result!.actualSpend).toBe(450);
			expect(result!.amount).toBe(2000);
		});
	});

	// ── getSuggestions ─────────────────────────────────────────────────────────

	describe("getSuggestions", () => {
		it("throws FORBIDDEN if category not owned by user", async () => {
			db.category.findFirst.mockResolvedValue(null);

			await expect(
				getSuggestions(db as never, "user-1", "cat-999"),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("returns all zeros when no spending history", async () => {
			db.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" });
			mockSumExpensesForCurrency.mockResolvedValue({ total: 0, totalInUSD: 0 });

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			expect(result).toEqual({ suggestedAmount: 0, averageSpend: 0, lastMonthSpend: 0 });
		});

		it("zero-spend months are excluded from average calculation", async () => {
			db.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" });
			// Month 1: 300, Month 2: 0 (excluded), Month 3: 100
			// Only months with positive spend are included
			mockSumExpensesForCurrency
				.mockResolvedValueOnce({ total: 300, totalInUSD: 300 })
				.mockResolvedValueOnce({ total: 0, totalInUSD: 0 })
				.mockResolvedValueOnce({ total: 100, totalInUSD: 100 });

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			// Average of [300, 100] = 200 (zero month excluded)
			expect(result.averageSpend).toBe(200);
		});

		it("median of 3 equal months returns that value", async () => {
			db.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" });
			mockSumExpensesForCurrency.mockResolvedValue({ total: 200, totalInUSD: 200 });

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			// Median of [200, 200, 200] = 200
			expect(result.suggestedAmount).toBe(200);
		});

		it("median picks middle value of sorted array", async () => {
			db.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" });
			mockSumExpensesForCurrency
				.mockResolvedValueOnce({ total: 100, totalInUSD: 100 })
				.mockResolvedValueOnce({ total: 400, totalInUSD: 400 })
				.mockResolvedValueOnce({ total: 200, totalInUSD: 200 });

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			// Sorted: [100, 200, 400] - median = 200
			expect(result.suggestedAmount).toBe(200);
		});

		it("rounds suggestedAmount and averageSpend to 2 decimal places", async () => {
			db.category.findFirst.mockResolvedValue({ id: "cat-1", userId: "user-1" });
			mockSumExpensesForCurrency
				.mockResolvedValueOnce({ total: 100, totalInUSD: 100 })
				.mockResolvedValueOnce({ total: 200, totalInUSD: 200 });
			// Only 2 months with spend → average = 300/2 = 150

			const result = await getSuggestions(db as never, "user-1", "cat-1");

			expect(Number.isInteger(result.suggestedAmount * 100)).toBe(true);
			expect(Number.isInteger(result.averageSpend * 100)).toBe(true);
		});
	});

	// ── copyFromLastMonth ──────────────────────────────────────────────────────

	describe("copyFromLastMonth", () => {
		it("throws CONFLICT if budgets already exist for target month", async () => {
			db.budget.findMany.mockResolvedValue([makeDbBudget()]); // existing budgets found

			await expect(
				copyFromLastMonth(db as never, "user-1", new Date("2024-06-01")),
			).rejects.toMatchObject({ code: "CONFLICT" });
		});

		it("throws NOT_FOUND if no source month has budgets", async () => {
			db.budget.findMany.mockResolvedValue([]); // no existing budgets in target month
			db.budget.groupBy.mockResolvedValue([]); // no other months either

			await expect(
				copyFromLastMonth(db as never, "user-1", new Date("2024-06-01")),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("copies budgets from most recent source month", async () => {
			db.budget.findMany
				.mockResolvedValueOnce([]) // no existing budgets in target month
				.mockResolvedValueOnce([makeDbBudget({ period: new Date("2024-05-01") })]); // source month
			db.budget.groupBy.mockResolvedValue([{ period: new Date("2024-05-01"), _count: { period: 1 } }]);
			db.budget.create.mockResolvedValue(
				makeDbBudget({ period: new Date("2024-06-01"), rolloverAmount: 0 }),
			);

			const result = await copyFromLastMonth(db as never, "user-1", new Date("2024-06-01"));

			expect(db.budget.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						userId: "user-1",
					}),
				}),
			);
			expect(result).toHaveLength(1);
		});
	});
});
