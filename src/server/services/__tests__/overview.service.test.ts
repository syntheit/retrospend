import { beforeEach, describe, expect, it, vi } from "vitest";
import { type TestExpenseRow, useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { getOverviewStats, type OverviewOptions } from "../overview.service";
import { RateCache } from "../rate-cache";

const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
	// spent() looks up hidden projects when a caller does not pass them.
	getExcludedProjectIds: async () => [],
}));

// Rate table: ARS blue 1560 (preferred).
const ARS = 1560;
const MONTH = new Date(2024, 5, 15);
const NOW = new Date(2024, 6, 20); // June is a past month

function budget(overrides: Record<string, unknown> = {}) {
	return {
		id: "b-food",
		userId: "user-1",
		categoryId: "cat-food",
		amount: 300,
		currency: "USD",
		period: new Date(2024, 5, 1),
		type: "FIXED" as const,
		isRollover: false,
		rolloverAmount: 0,
		pegToActual: false,
		createdAt: new Date(2024, 0, 1),
		category: {
			id: "cat-food",
			name: "Food",
			color: "blue",
			icon: null,
			isFixed: false,
		},
		...overrides,
	};
}

function usd(date: Date, amount: number, categoryId: string | null) {
	return { date, amount, currency: "USD", amountInUSD: amount, categoryId };
}

function ars(
	date: Date,
	amount: number,
	rateAtTheTime: number,
	categoryId: string | null,
): TestExpenseRow {
	return {
		date,
		amount,
		currency: "ARS",
		amountInUSD: Math.round((amount / rateAtTheTime) * 100) / 100,
		categoryId,
	};
}

describe("getOverviewStats", () => {
	let db: ReturnType<typeof createMockDb>;

	const run = (overrides: Partial<OverviewOptions> = {}) =>
		getOverviewStats(db as never, "user-1", {
			month: MONTH,
			homeCurrency: "USD",
			fiscalStartDay: 1,
			monthlyIncome: 0,
			monthlyIncomeCurrency: "USD",
			rateCache: new RateCache(db as never),
			now: NOW,
			...overrides,
		});

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		useExpenseTable(db, []);
		mockGetSharedExpenseShares.mockResolvedValue([]);
	});

	it("month total counts unbudgeted categories too", async () => {
		db.budget.findMany.mockResolvedValue([budget()]);
		useExpenseTable(db, [
			usd(new Date(2024, 5, 3), 100, "cat-food"),
			usd(new Date(2024, 5, 4), 250, "cat-travel"), // no budget
			usd(new Date(2024, 5, 5), 50, null),
		]);

		const stats = await run();

		expect(stats.monthTotal).toBe(400);
		expect(stats.workEquivalent.totalSpent).toBe(400);
		// Budget pace still compares budgets with budgeted spending
		expect(stats.dailyBudgetPace.totalBudget).toBe(300);
		expect(stats.dailyBudgetPace.totalSpent).toBe(100);
	});

	it("month total without any budgets", async () => {
		db.budget.findMany.mockResolvedValue([]);
		useExpenseTable(db, [usd(new Date(2024, 5, 3), 80, "cat-food")]);

		const stats = await run();

		expect(stats.monthTotal).toBe(80);
		expect(stats.dailyBudgetPace.totalBudget).toBe(0);
	});

	it("ARS home: ARS spending as entered, budgets and USD spending at the ARS rate", async () => {
		db.budget.findMany.mockResolvedValue([
			budget(),
			budget({
				id: "b-rent",
				categoryId: "cat-rent",
				currency: "ARS",
				amount: 500000,
				category: {
					id: "cat-rent",
					name: "Rent",
					color: "red",
					icon: null,
					isFixed: true,
				},
			}),
		]);
		useExpenseTable(db, [
			ars(new Date(2024, 5, 1), 500000, 1000, "cat-rent"),
			usd(new Date(2024, 5, 3), 20, "cat-food"),
			ars(new Date(2024, 5, 4), 7000, 1000, "cat-travel"),
		]);

		const stats = await run({ homeCurrency: "ARS" });

		expect(stats.monthTotal).toBeCloseTo(500000 + 20 * ARS + 7000);
		expect(stats.dailyBudgetPace.totalBudget).toBeCloseTo(500000 + 300 * ARS);
		expect(stats.dailyBudgetPace.totalSpent).toBeCloseTo(500000 + 20 * ARS);
		expect(stats.dailyBudgetPace.variableBudget).toBeCloseTo(300 * ARS);
		expect(stats.dailyBudgetPace.variableSpent).toBeCloseTo(20 * ARS);
	});

	it("matches the budget page: same *InHome figures", async () => {
		db.budget.findMany.mockResolvedValue([
			budget({ currency: "ARS", amount: 50000 }),
		]);
		useExpenseTable(db, [ars(new Date(2024, 5, 3), 12345, 900, "cat-food")]);

		const stats = await run({ homeCurrency: "ARS" });

		expect(stats.dailyBudgetPace.totalBudget).toBe(50000);
		expect(stats.dailyBudgetPace.totalSpent).toBe(12345);
		expect(stats.monthTotal).toBe(12345);
	});

	it("global budget: pace uses all spending", async () => {
		db.budget.findMany.mockResolvedValue([
			budget({
				id: "b-global",
				categoryId: null,
				category: null,
				amount: 1000,
			}),
			budget(),
		]);
		useExpenseTable(db, [
			usd(new Date(2024, 5, 3), 100, "cat-food"),
			usd(new Date(2024, 5, 4), 250, "cat-travel"),
		]);

		const stats = await run();

		expect(stats.dailyBudgetPace.totalBudget).toBe(1000);
		expect(stats.dailyBudgetPace.totalSpent).toBe(350);
	});

	it("includes shared shares in the month total", async () => {
		db.budget.findMany.mockResolvedValue([]);
		mockGetSharedExpenseShares.mockResolvedValue([
			{
				amount: 3000,
				currency: "ARS",
				amountInUSD: 2,
				categoryId: null,
				date: new Date(2024, 5, 9),
			},
		]);

		const stats = await run({ homeCurrency: "ARS" });

		expect(stats.monthTotal).toBe(3000);
	});

	it("converts income in another currency to the home currency", async () => {
		db.budget.findMany.mockResolvedValue([]);

		const usdIncome = await run({
			homeCurrency: "ARS",
			monthlyIncome: 2000,
			monthlyIncomeCurrency: "USD",
		});
		const arsIncome = await run({
			homeCurrency: "USD",
			monthlyIncome: 3120000,
			monthlyIncomeCurrency: "ARS",
		});
		const sameCurrency = await run({
			homeCurrency: "ARS",
			monthlyIncome: 3000000,
			monthlyIncomeCurrency: "ARS",
		});

		expect(usdIncome.workEquivalent.monthlyIncome).toBeCloseTo(2000 * ARS);
		expect(arsIncome.workEquivalent.monthlyIncome).toBeCloseTo(2000);
		expect(sameCurrency.workEquivalent.monthlyIncome).toBe(3000000);
	});

	it("last 24 hours only for the running month", async () => {
		db.budget.findMany.mockResolvedValue([]);
		const now = new Date(2024, 5, 20, 12);
		useExpenseTable(db, [
			usd(new Date(2024, 5, 20, 8), 15, null),
			usd(new Date(2024, 5, 18), 99, null),
		]);

		const running = await run({ now });
		const past = await run();

		expect(running.isCurrentMonth).toBe(true);
		expect(running.last24Hours).toBe(15);
		expect(past.isCurrentMonth).toBe(false);
		expect(past.last24Hours).toBe(0);
	});
});
