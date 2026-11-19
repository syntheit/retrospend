/**
 * Imported expenses (and the sidecar's) have cuid ids, not uuids: the bulk
 * and delete procedures take any id and still only touch your own rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";

const mockDb = vi.hoisted(() => ({}) as ReturnType<typeof createMockDb>);

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));

vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { makeSession } from "~/test/trpc-test-utils";
import { expenseRouter } from "../expense";

const caller = () =>
	createCallerFactory(expenseRouter)({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers: new Headers(),
	});

/** An imported row's id, as Expense.id's cuid() default writes it. */
const IMPORTED = "cm2x7k9q80001lb08d4f3h2jz";
const CATEGORY = "clcategory0000000000001";

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
});

describe("expense ids", () => {
	// Changed in PR7: the bulk write reads the rows first (the domain core's
	// reach rules) and writes the ones it takes, so the mock serves both reads.
	it("categorizes an imported (cuid) row, scoped to its owner", async () => {
		mockDb.category.findFirst.mockResolvedValue({
			id: CATEGORY,
			kind: "EXPENSE",
			excludeByDefault: false,
		});
		mockDb.category.findFirstOrThrow.mockResolvedValue({ name: "Groceries" });
		mockDb.expense.findMany.mockResolvedValue([
			{
				id: IMPORTED,
				title: "Imported",
				amount: "10",
				currency: "USD",
				date: new Date("2026-03-05T15:00:00Z"),
				direction: "OUT",
				isAmortizedChild: false,
				isAmortizedParent: false,
				exchangeRate: "1",
				amountInUSD: "10",
				rateType: null,
				homeCurrency: "USD",
				homeRate: null,
				homeAmount: null,
				pricingSource: "MANUAL",
				location: null,
				description: null,
				categoryId: null,
				excludeFromAnalytics: false,
				_count: { accountLegs: 0 },
			},
		]);
		mockDb.expense.updateMany.mockResolvedValue({ count: 1 });

		const out = await caller().bulkUpdateCategory({
			expenseIds: [IMPORTED],
			categoryId: CATEGORY,
		});

		expect(out).toEqual({ count: 1, categoryName: "Groceries" });
		expect(mockDb.expense.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: { in: [IMPORTED] }, userId: "user-1" },
			}),
		);
		expect(mockDb.expense.updateMany).toHaveBeenCalledWith({
			where: { id: { in: [IMPORTED] }, userId: "user-1" },
			data: { categoryId: CATEGORY },
		});
	});

	it("still refuses an empty or oversized id", async () => {
		await expect(
			caller().bulkUpdateCategory({ expenseIds: [""], categoryId: CATEGORY }),
		).rejects.toThrow();
		await expect(
			caller().deleteExpense({ id: "x".repeat(65) }),
		).rejects.toThrow();
	});
});
