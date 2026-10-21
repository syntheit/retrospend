/**
 * Budget router (batch 4): CSV export/import keep the budget currency, periods
 * are read in the user's time zone, and a missing rate is a BAD_REQUEST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";

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
import { callAndFlush, makeSession } from "~/test/trpc-test-utils";
import { budgetRouter } from "../budget";

const createCaller = createCallerFactory(budgetRouter);
const caller = (headers: Headers = new Headers()) =>
	createCaller({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers,
	});

const CATEGORY_ID = "clcategory0000000000001";

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
	useRateTable(mockDb);
	Object.assign(mockDb, { projectParticipant: { findMany: vi.fn(async () => []) } });
	mockDb.user.findUnique.mockResolvedValue({
		homeCurrency: "ARS",
		fiscalMonthStartDay: 1,
	});
	mockDb.category.findMany.mockResolvedValue([{ id: CATEGORY_ID, name: "Food" }]);
	mockDb.category.findFirst.mockResolvedValue({ id: CATEGORY_ID, userId: "user-1" });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("budget CSV", () => {
	it("export includes the currency column", async () => {
		mockDb.budget.findMany.mockResolvedValue([
			{
				amount: 250000,
				currency: "ARS",
				period: new Date(2026, 9, 1),
				isRollover: false,
				rolloverAmount: 0,
				pegToActual: false,
				category: { name: "Food" },
			},
		]);

		const { csv } = await callAndFlush(() => caller().exportCsv());
		const [header, row] = csv.split("\n");

		expect(header).toContain("currency");
		expect(row).toContain("ARS");
	});

	it("import keeps the row currency and defaults to the home currency", async () => {
		await callAndFlush(() =>
			caller().importBudgets({
				rows: [
					{ categoryName: "Food", amount: 500, currency: "usd", period: new Date(2026, 9, 1) },
					{ categoryName: "Food", amount: 300000, period: new Date(2026, 10, 1) },
				],
			}),
		);

		const currencies = mockDb.budget.upsert.mock.calls.map(
			(c) => (c[0] as { create: { currency: string } }).create.currency,
		);
		expect(currencies).toEqual(["USD", "ARS"]);
	});
});

describe("budget periods in the user's time zone", () => {
	it("a Berlin browser's local midnight Oct 1 saves an October budget", async () => {
		mockDb.budget.upsert.mockResolvedValue({ amount: 100, category: null });

		await callAndFlush(() =>
			caller(new Headers({ "x-timezone": "Europe/Berlin" })).upsertBudget({
				categoryId: CATEGORY_ID,
				amount: 100,
				currency: "EUR",
				period: new Date("2026-09-30T22:00:00Z"),
			}),
		);

		const args = mockDb.budget.upsert.mock.calls[0]![0] as {
			create: { period: Date };
		};
		expect(args.create.period).toEqual(new Date(2026, 9, 1));
	});
});

describe("missing rates", () => {
	it("a budget in a currency with no rate is a BAD_REQUEST, not a 1:1 conversion", async () => {
		mockDb.budget.findMany.mockResolvedValue([
			{
				id: "b1",
				userId: "user-1",
				categoryId: CATEGORY_ID,
				amount: 100,
				currency: "XYZ",
				period: new Date(2026, 9, 1),
				type: "FIXED",
				isRollover: false,
				rolloverAmount: 0,
				pegToActual: false,
				category: null,
			},
		]);
		mockDb.splitParticipant.findMany.mockResolvedValue([]);

		await expect(
			callAndFlush(() => caller().getBudgets({ month: new Date(2026, 9, 15) })),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
