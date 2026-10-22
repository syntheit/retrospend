import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRateError } from "~/lib/money";
import { type TestExpenseRow, useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { StatsService } from "../stats.service";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
	// spent() looks up hidden projects when a caller does not pass them.
	getExcludedProjectIds: async () => [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Rate table: ARS blue 1560 (preferred), EUR 0.8787, BTC 64545.9 USD per coin.
const ARS = 1560;

function usd(date: Date, amount: number, extra: Partial<TestExpenseRow> = {}) {
	return { date, amount, currency: "USD", amountInUSD: amount, ...extra };
}

/** An ARS expense whose USD value was captured at its own (older) rate. */
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
		...extra,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StatsService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: StatsService;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		service = new StatsService(db as never);
		mockGetSharedExpenseShares.mockResolvedValue([]);
	});

	// ── getSummaryStats ────────────────────────────────────────────────────────

	describe("getSummaryStats", () => {
		// A past month gives a deterministic daysElapsed (the whole month).
		const PAST_MONTH = new Date(2023, 0, 15);

		it("USD home: personal + shared spending in the month", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 10), 100),
				usd(new Date(2023, 1, 10), 999), // next month
			]);
			mockGetSharedExpenseShares.mockImplementation(
				async (_db: unknown, _u: unknown, range: { gte: Date }) =>
					range.gte.getMonth() === 0
						? [{ amount: 50, currency: "USD", amountInUSD: 50, categoryId: null, date: new Date(2023, 0, 5) }]
						: [],
			);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.totalThisMonth).toBeCloseTo(150);
		});

		it("ARS home: ARS expenses count as entered, not round-tripped through USD", async () => {
			// 100000 ARS logged when 1 USD = 1000 ARS (100 USD stored). The table
			// now says 1560; the old math showed 156000 ARS.
			useExpenseTable(db, [ars(new Date(2023, 0, 10), 100000, 1000)]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "ARS");

			expect(result.totalThisMonth).toBe(100000);
		});

		it("ARS home: a USD expense converts at the home rate for the period", async () => {
			useExpenseTable(db, [
				ars(new Date(2023, 0, 10), 50000, 1000),
				usd(new Date(2023, 0, 11), 20),
			]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "ARS");

			expect(result.totalThisMonth).toBeCloseTo(50000 + 20 * ARS);
		});

		it("crypto home: USD spending converts to coins without rounding to cents", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 10), 100)]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "BTC");

			expect(result.totalThisMonth).toBeCloseTo(100 / 64545.9, 10);
		});

		it("missing home rate is an error, not a 1:1 conversion", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 10), 100)]);

			await expect(
				service.getSummaryStats("user-1", PAST_MONTH, "XYZ"),
			).rejects.toBeInstanceOf(MissingRateError);
		});

		it("a home currency with no rate still works when nothing needs converting", async () => {
			useExpenseTable(db, [
				{ date: new Date(2023, 0, 10), amount: 70, currency: "XYZ", amountInUSD: 0 },
			]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "XYZ");

			expect(result.totalThisMonth).toBe(70);
		});

		it("excluded and draft expenses do not count", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 10), 100),
				usd(new Date(2023, 0, 11), 500, { excludeFromAnalytics: true }),
				usd(new Date(2023, 0, 12), 700, { status: "DRAFT" }),
				usd(new Date(2023, 0, 13), 900, { isAmortizedParent: true }),
			]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.totalThisMonth).toBe(100);
		});

		it("changeVsLastMonth is null when last month total = 0", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 10), 100)]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.changeVsLastMonth).toBeNull();
		});

		it("changeVsLastMonth compares home-currency totals", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 10), 150),
				usd(new Date(2022, 11, 10), 100),
			]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.changeVsLastMonth).toBeCloseTo(50);
		});

		it("projectedSpend averages the last 3 months that had spending", async () => {
			useExpenseTable(db, [
				usd(new Date(2022, 11, 15), 100),
				// November 2022 empty: left out of the average
				usd(new Date(2022, 9, 15), 300),
				usd(new Date(2022, 8, 15), 5000), // 4 months back, ignored
			]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.projectedSpend).toBeCloseTo(200);
		});

		it("projectedSpend is 0, not this month's total, with no earlier spending", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 10), 310)]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.totalThisMonth).toBeCloseTo(310);
			expect(result.projectedSpend).toBe(0);
		});

		it("dailyAverage = total / days in a past month", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 10), 310)]);

			const result = await service.getSummaryStats("user-1", PAST_MONTH, "USD");

			expect(result.dailyAverage).toBeCloseTo(10);
		});

		it("buckets by the user's time zone", async () => {
			// 22:30 on Jan 31 in Buenos Aires is Feb 1 in UTC.
			useExpenseTable(db, [usd(new Date("2023-02-01T01:30:00Z"), 40)]);
			const tzService = new StatsService(
				db as never,
				undefined,
				undefined,
				"America/Argentina/Buenos_Aires",
			);

			const jan = await tzService.getSummaryStats(
				"user-1",
				new Date("2023-01-15T12:00:00Z"),
				"USD",
			);
			const feb = await tzService.getSummaryStats(
				"user-1",
				new Date("2023-02-15T12:00:00Z"),
				"USD",
			);

			expect(jan.totalThisMonth).toBe(40);
			expect(feb.totalThisMonth).toBe(0);
		});
	});

	// ── getCategoryBreakdown ───────────────────────────────────────────────────

	describe("getCategoryBreakdown", () => {
		const MONTH = new Date(2023, 0, 15);

		it("groups by category, sorted by value desc", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 3), 300, { categoryId: "cat-1" }),
				usd(new Date(2023, 0, 4), 100, { categoryId: "cat-2" }),
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-1", name: "Food", color: "blue", icon: null },
				{ id: "cat-2", name: "Transport", color: "green", icon: null },
			]);

			const result = await service.getCategoryBreakdown("user-1", MONTH, "USD");

			expect(result.map((r) => [r.id, r.value])).toEqual([
				["cat-1", 300],
				["cat-2", 100],
			]);
		});

		it("null categoryId maps to 'uncategorized'", async () => {
			useExpenseTable(db, [usd(new Date(2023, 0, 3), 50)]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getCategoryBreakdown("user-1", MONTH, "USD");

			expect(result[0]).toMatchObject({ id: "uncategorized", name: "Uncategorized" });
		});

		it("ARS home: mixes native ARS and converted USD per category", async () => {
			useExpenseTable(db, [
				ars(new Date(2023, 0, 3), 30000, 1000, { categoryId: "cat-1" }),
				usd(new Date(2023, 0, 4), 10, { categoryId: "cat-1" }),
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-1", name: "Food", color: "blue", icon: null },
			]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{ amount: 2000, currency: "ARS", amountInUSD: 1.28, categoryId: "cat-1", date: new Date(2023, 0, 5) },
			]);

			const result = await service.getCategoryBreakdown("user-1", MONTH, "ARS");

			expect(result[0]!.value).toBeCloseTo(30000 + 10 * ARS + 2000);
		});

		it("returns empty array when no expenses", async () => {
			useExpenseTable(db, []);

			const result = await service.getCategoryBreakdown("user-1", MONTH, "USD");

			expect(result).toHaveLength(0);
		});
	});

	// ── getDailyTrend ──────────────────────────────────────────────────────────

	describe("getDailyTrend", () => {
		const MONTH = new Date(2023, 0, 15);

		it("returns one entry per day of a past month", async () => {
			useExpenseTable(db, []);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			expect(result).toHaveLength(31);
		});

		it("cumulative values carry forward over empty days", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 5), 100),
				usd(new Date(2023, 0, 20), 50),
			]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			expect(result.find((d) => d.day === "Jan 5")!.total).toBe(100);
			expect(result.find((d) => d.day === "Jan 6")!.total).toBe(100);
			expect(result.at(-1)!.total).toBe(150);
		});

		it("splits fixed and variable categories", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 1), 1500, { categoryId: "cat-rent" }),
				usd(new Date(2023, 0, 10), 75, { categoryId: "cat-food" }),
			]);
			db.category.findMany.mockResolvedValue([
				{ id: "cat-rent", isFixed: false, name: "Rent" },
				{ id: "cat-food", isFixed: false, name: "Food" },
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");
			const day10 = result.find((d) => d.day === "Jan 10")!;

			expect(day10.fixed).toBe(1500);
			expect(day10.variable).toBe(75);
		});

		it("ARS home: daily amounts use the totals rule", async () => {
			useExpenseTable(db, [
				ars(new Date(2023, 0, 2), 9000, 900),
				usd(new Date(2023, 0, 2), 1),
			]);
			db.category.findMany.mockResolvedValue([]);

			const result = await service.getDailyTrend("user-1", MONTH, "ARS");

			expect(result.find((d) => d.day === "Jan 2")!.total).toBeCloseTo(9000 + ARS);
		});

		it("puts a late-evening expense on its local day", async () => {
			useExpenseTable(db, [usd(new Date("2023-02-01T01:30:00Z"), 40)]);
			db.category.findMany.mockResolvedValue([]);
			const tzService = new StatsService(
				db as never,
				undefined,
				undefined,
				"America/Argentina/Buenos_Aires",
			);

			const result = await tzService.getDailyTrend(
				"user-1",
				new Date("2023-01-15T12:00:00Z"),
				"USD",
			);

			expect(result).toHaveLength(31);
			expect(result.find((d) => d.day === "Jan 31")!.total).toBe(40);
			expect(result.find((d) => d.day === "Jan 30")!.total).toBe(0);
		});

		it("includes shared shares", async () => {
			useExpenseTable(db, []);
			db.category.findMany.mockResolvedValue([]);
			mockGetSharedExpenseShares.mockResolvedValue([
				{ amount: 40, currency: "USD", amountInUSD: 40, categoryId: null, date: new Date(2023, 0, 15) },
			]);

			const result = await service.getDailyTrend("user-1", MONTH, "USD");

			expect(result.find((d) => d.day === "Jan 15")!.total).toBe(40);
		});
	});

	// ── getLifetimeStats ───────────────────────────────────────────────────────

	describe("getLifetimeStats", () => {
		it("USD home: totals all spending", async () => {
			useExpenseTable(db, [
				usd(new Date(2023, 0, 1), 300),
				usd(new Date(2024, 0, 1), 200),
			]);

			const result = await service.getLifetimeStats("user-1", "USD");

			expect(result).toEqual({ totalSpent: 500, totalTransactions: 2 });
		});

		it("ARS home: ARS counts as entered, USD at today's rate", async () => {
			useExpenseTable(db, [
				ars(new Date(2023, 0, 1), 100000, 300),
				usd(new Date(2024, 0, 1), 200),
			]);

			const result = await service.getLifetimeStats("user-1", "ARS");

			expect(result.totalSpent).toBeCloseTo(100000 + 200 * ARS);
		});

		it("returns 0 when no expenses", async () => {
			useExpenseTable(db, []);

			const result = await service.getLifetimeStats("user-1", "USD");

			expect(result).toEqual({ totalSpent: 0, totalTransactions: 0 });
		});
	});
});
