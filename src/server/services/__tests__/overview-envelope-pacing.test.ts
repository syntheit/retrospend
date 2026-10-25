import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvelopePacing } from "~/lib/schemas/envelope-migration";
import { useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { getOverviewStats } from "../overview.service";
import { RateCache } from "../rate-cache";

const mockGetSharedExpenseShares = vi.hoisted(() => vi.fn());

vi.mock("~/server/services/shared-expense-integration", () => ({
	getSharedExpenseShares: mockGetSharedExpenseShares,
	getExcludedProjectIds: async () => [],
}));

const MONTH = new Date(2024, 5, 15);
const RUNNING = new Date(2024, 5, 20, 12);
const LATER = new Date(2024, 6, 20);

const pacing: EnvelopePacing = {
	currency: "USD",
	month: 202406,
	total: {
		budget: { minor: 308_750, currency: "USD" },
		spent: { minor: 23_750, currency: "USD" },
	},
	variable: {
		budget: { minor: 188_750, currency: "USD" },
		spent: { minor: 5_005, currency: "USD" },
	},
	daysLeft: 10,
	incomplete: false,
};

describe("getOverviewStats with the envelope budget on", () => {
	let db: ReturnType<typeof createMockDb>;

	const run = (envelopePacing: EnvelopePacing | null, now: Date) =>
		getOverviewStats(db as never, "user-1", {
			month: MONTH,
			homeCurrency: "USD",
			fiscalStartDay: 1,
			monthlyIncome: 0,
			monthlyIncomeCurrency: "USD",
			rateCache: new RateCache(db as never),
			now,
			envelopePacing,
		});

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		useExpenseTable(db, []);
		mockGetSharedExpenseShares.mockResolvedValue([]);
	});

	it("reads the pace from envelope totals as exact decimals and never reads the old budgets", async () => {
		const stats = await run(pacing, RUNNING);
		expect(stats.dailyBudgetPace).toMatchObject({
			totalBudget: 3087.5,
			totalSpent: 237.5,
			variableBudget: 1887.5,
			variableSpent: 50.05,
		});
		expect(db.budget.findMany).not.toHaveBeenCalled();
	});

	it("shows no pace without a book, or for a month that is not the running one", async () => {
		expect((await run(null, RUNNING)).dailyBudgetPace.totalBudget).toBe(0);
		expect((await run(pacing, LATER)).dailyBudgetPace.totalBudget).toBe(0);
	});
});
