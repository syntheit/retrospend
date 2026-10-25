import { beforeEach, describe, expect, it, vi } from "vitest";
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
