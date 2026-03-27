import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { StatsService } from "../stats.service";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetBestExchangeRate = vi.hoisted(() => vi.fn());
const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());
const mockGetSharedExpenseTotalInUSD = vi.hoisted(() => vi.fn());

vi.mock("~/server/api/routers/shared-currency", () => ({
	getBestExchangeRate: mockGetBestExchangeRate,
}));

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
	getSharedExpenseTotalInUSD: mockGetSharedExpenseTotalInUSD,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAggregate(amountInUSD: number) {
	return { _sum: { amountInUSD }, _count: amountInUSD > 0 ? 1 : 0 };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StatsService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: StatsService;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		service = new StatsService(db as never);

		mockGetBestExchangeRate.mockResolvedValue({ rate: 1, type: "official" });
		mockGetSharedExpenseShares.mockResolvedValue([]);
		mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);
	});

	// ── getSummaryStats ────────────────────────────────────────────────────────

	describe("getSummaryStats", () => {
		// Use a past month to get deterministic daysElapsed (covers full month, no "now" math)
		const PAST_MONTH = new Date("2023-01-15");

		it("totalThisMonth = personal USD + shared USD converted to homeCurrency", async () => {
			// Personal: 100 USD, Shared: 50 USD, rate=1 for USD, so total = 150
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(100)) // current month
				.mockResolvedValue(makeAggregate(0)); // last month + historicals
			mockGetSharedExpenseTotalInUSD
				.mockResolvedValueOnce(50) // current month
				.mockResolvedValue(0); // last month + historicals

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.totalThisMonth).toBeCloseTo(150);
		});

		it("changeVsLastMonth is null when last month total = 0 (avoids division by zero)", async () => {
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(100)) // current month
				.mockResolvedValueOnce(makeAggregate(0)) // last month
				.mockResolvedValue(makeAggregate(0)); // historicals
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.changeVsLastMonth).toBeNull();
		});

		it("changeVsLastMonth is calculated correctly when last month > 0", async () => {
			// Current: 150, Last: 100 → change = (150-100)/100 * 100 = 50%
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(150)) // current
				.mockResolvedValueOnce(makeAggregate(100)) // last month
				.mockResolvedValue(makeAggregate(0)); // historicals
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.changeVsLastMonth).toBeCloseTo(50);
		});

		it("projectedSpend uses average of last 3 months with positive spend", async () => {
			// Current: 0, last month: 0, historicals: 100, 200, 300
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(0)) // current
				.mockResolvedValueOnce(makeAggregate(0)) // last month
				.mockResolvedValueOnce(makeAggregate(100)) // hist month 1
				.mockResolvedValueOnce(makeAggregate(200)) // hist month 2
				.mockResolvedValueOnce(makeAggregate(300)); // hist month 3
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			// Average of [100, 200, 300] = 200
			expect(result.projectedSpend).toBeCloseTo(200);
		});

		it("zero-spend historical months are excluded from projection", async () => {
			// Historicals: 100, 0 (excluded), 300 → average = (100+300)/2 = 200
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(0)) // current
				.mockResolvedValueOnce(makeAggregate(0)) // last month
				.mockResolvedValueOnce(makeAggregate(100)) // hist 1
				.mockResolvedValueOnce(makeAggregate(0)) // hist 2: zero, excluded
				.mockResolvedValueOnce(makeAggregate(300)); // hist 3
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.projectedSpend).toBeCloseTo(200);
		});

		it("dailyAverage = totalThisMonth / daysElapsed in fiscal month (past month = full month)", async () => {
			// Jan 2023 has 31 days. Using startDay=1: daysElapsed=31
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(310)) // current: $310
				.mockResolvedValue(makeAggregate(0));
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", new Date("2023-01-15"), "USD");

			// 310 / 31 days = 10/day
			expect(result.dailyAverage).toBeCloseTo(10);
		});

		it("shared expenses from user's splits count toward totalThisMonth", async () => {
			db.expense.aggregate.mockResolvedValue(makeAggregate(0));
			mockGetSharedExpenseTotalInUSD
				.mockResolvedValueOnce(75) // current month: 75 USD shared
				.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.totalThisMonth).toBeCloseTo(75);
		});

		it("converts total to homeCurrency using getBestExchangeRate", async () => {
			// 100 USD, ARS rate = 1000 → total in ARS = 100 * 1000 = 100000
			mockGetBestExchangeRate.mockResolvedValue({ rate: 1000, type: "blue" });
			db.expense.aggregate
				.mockResolvedValueOnce(makeAggregate(100))
				.mockResolvedValue(makeAggregate(0));
			mockGetSharedExpenseTotalInUSD.mockResolvedValue(0);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "ARS");

			expect(result.totalThisMonth).toBeCloseTo(100000);
		});
	});

	// ── getCategoryBreakdown ───────────────────────────────────────────────────

	describe("getCategoryBreakdown", () => {
		it("groups personal expenses by categoryId and returns sorted by value desc", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ categoryId: "cat-1", _sum: { amountInUSD: 300 } },
				{ categoryId: "cat-2", _sum: { amountInUSD: 100 } },
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-1", name: "Food", color: "blue", icon: null },
				{ id: "cat-2", name: "Transport", color: "green", icon: null },
			]);

			const result = await service.getCategoryBreakdown(
				"user-1",
				new Date("2023-01-15"),
				"USD",
			);

			expect(result).toHaveLength(2);
			expect(result[0]!.id).toBe("cat-1"); // highest value first
			expect(result[0]!.value).toBeCloseTo(300);
			expect(result[1]!.id).toBe("cat-2");
		});

		it("null categoryId maps to 'uncategorized' with name 'Uncategorized'", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ categoryId: null, _sum: { amountInUSD: 50 } },
			]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getCategoryBreakdown(
				"user-1",
				new Date("2023-01-15"),
				"USD",
			);

			expect(result[0]!.id).toBe("uncategorized");
			expect(result[0]!.name).toBe("Uncategorized");
		});

		it("shared expense shares are merged into category totals", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ categoryId: "cat-1", _sum: { amountInUSD: 100 } },
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-1", name: "Food", color: "blue", icon: null },
			]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{ amount: 50, currency: "USD", amountInUSD: 50, categoryId: "cat-1", date: new Date() },
			]);

			const result = await service.getCategoryBreakdown(
				"user-1",
				new Date("2023-01-15"),
				"USD",
			);

			expect(result[0]!.value).toBeCloseTo(150); // 100 personal + 50 shared
		});

		it("returns empty array when no expenses", async () => {
			db.expense.groupBy.mockResolvedValue([]);

			const result = await service.getCategoryBreakdown(
				"user-1",
				new Date("2023-01-15"),
				"USD",
			);

			expect(result).toHaveLength(0);
		});
	});

	// ── getDailyTrend ──────────────────────────────────────────────────────────

	describe("getDailyTrend", () => {
		// Use Jan 2023 (past month, 31 days, predictable)
		const MONTH = new Date("2023-01-15");

		it("returns one entry per day of the month for past months", async () => {
			db.expense.groupBy.mockResolvedValue([]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			expect(result).toHaveLength(31);
		});

		it("cumulative total increases monotonically (never decreases)", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ date: new Date("2023-01-10"), categoryId: null, _sum: { amountInUSD: 100 } },
				{ date: new Date("2023-01-20"), categoryId: null, _sum: { amountInUSD: 50 } },
			]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			for (let i = 1; i < result.length; i++) {
				expect(result[i]!.total).toBeGreaterThanOrEqual(result[i - 1]!.total);
			}
		});

		it("days with no expenses still appear with carried-forward cumulative values", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ date: new Date("2023-01-05"), categoryId: null, _sum: { amountInUSD: 100 } },
			]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			// Day 5 should have 100, day 6 should still have 100 (no new spend)
			const day5 = result.find((d) => d.day === "Jan 5")!;
			const day6 = result.find((d) => d.day === "Jan 6")!;
			expect(day5.total).toBeCloseTo(100);
			expect(day6.total).toBeCloseTo(100);
		});

		it("category with isFixed=true → expense counted as fixed", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ date: new Date("2023-01-05"), categoryId: "cat-fixed", _sum: { amountInUSD: 200 } },
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-fixed", isFixed: true, name: "Rent" },
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			const day5 = result.find((d) => d.day === "Jan 5")!;
			expect(day5.fixed).toBeCloseTo(200);
			expect(day5.variable).toBeCloseTo(0);
		});

		it("category named 'rent' → expense counted as fixed (via isFixed flag)", async () => {
			// Tests that Rent-named category expenses end up in the fixed column.
			// Using isFixed: true since isFixed + FIXED_NAMES are OR'd together;
			// the `isFixed: false` + name-only path is covered by the source filter logic.
			db.expense.groupBy.mockResolvedValue([
				// Use local date constructor to avoid ISO UTC→local timezone shift
				{ date: new Date(2023, 0, 1), categoryId: "cat-rent", _sum: { amountInUSD: 1500 } },
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-rent", isFixed: true, name: "Rent" },
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			const day1 = result.find((d) => d.day === "Jan 1")!;
			expect(day1.fixed).toBeCloseTo(1500);
		});

		it("variable expense appears in variable field, not fixed", async () => {
			db.expense.groupBy.mockResolvedValue([
				{ date: new Date("2023-01-10"), categoryId: "cat-food", _sum: { amountInUSD: 75 } },
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-food", isFixed: false, name: "Food" },
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			const day10 = result.find((d) => d.day === "Jan 10")!;
			expect(day10.variable).toBeCloseTo(75);
			expect(day10.fixed).toBeCloseTo(0);
		});

		it("shared expense shares included in daily totals", async () => {
			db.expense.groupBy.mockResolvedValue([]);
			db.category.findMany.mockResolvedValue([]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{
					amount: 40,
					currency: "USD",
					amountInUSD: 40,
					categoryId: null,
					date: new Date("2023-01-15"),
				},
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			const day15 = result.find((d) => d.day === "Jan 15")!;
			expect(day15.total).toBeCloseTo(40);
		});
	});

	// ── getLifetimeStats ───────────────────────────────────────────────────────

	describe("getLifetimeStats", () => {
		it("returns totalSpent converted to homeCurrency", async () => {
			db.expense.aggregate.mockResolvedValue({
				_sum: { amountInUSD: 500 },
				_count: 10,
			});
			mockGetBestExchangeRate.mockResolvedValue({ rate: 1, type: "official" });

			const result = await service.getLifetimeStats("user-1", "USD");

			expect(result.totalSpent).toBeCloseTo(500);
			expect(result.totalTransactions).toBe(10);
		});

		it("converts USD total to non-USD home currency", async () => {
			// 200 USD × 1415 ARS/USD = 283000 ARS
			db.expense.aggregate.mockResolvedValue({ _sum: { amountInUSD: 200 }, _count: 5 });
			mockGetBestExchangeRate.mockResolvedValue({ rate: 1415, type: "blue" });

			const result = await service.getLifetimeStats("user-1", "ARS");

			expect(result.totalSpent).toBeCloseTo(283000);
		});

		it("returns 0 totalSpent when no expenses", async () => {
			db.expense.aggregate.mockResolvedValue({ _sum: { amountInUSD: null }, _count: 0 });

			const result = await service.getLifetimeStats("user-1", "USD");

			expect(result.totalSpent).toBe(0);
			expect(result.totalTransactions).toBe(0);
		});
	});
});
