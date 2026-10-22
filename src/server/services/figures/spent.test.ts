/**
 * spent(filter) on an in-memory expense table. Real-Postgres coverage of the
 * same rules (amortization modes, RLS, every reader) is in
 * services/__tests__/money-in-leak.pg.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type TestExpenseRow, useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { spentByCurrency, spentFigure, spentIn, spentItems } from "./spent";

const { shares, hidden } = vi.hoisted(() => ({
	shares: vi.fn(),
	hidden: vi.fn(),
}));

vi.mock("../shared-expense-integration", () => ({
	getSharedExpenseShares: shares,
	getExcludedProjectIds: hidden,
}));

const USER = "user-1";
const MARCH = {
	gte: new Date("2026-03-01T00:00:00Z"),
	lte: new Date("2026-03-31T23:59:59Z"),
};
const day = (d: number) => new Date(Date.UTC(2026, 2, d, 12));

const ars = (
	amount: number,
	extra: Partial<TestExpenseRow> = {},
): TestExpenseRow => ({
	date: day(5),
	amount,
	currency: "ARS",
	amountInUSD: amount / 1000,
	categoryId: "groceries",
	...extra,
});

/** One of every kind of row; only the first and the refund are spending. */
const LEDGER: TestExpenseRow[] = [
	ars(12_000),
	ars(2_000, { direction: "IN", inType: "REFUND", date: day(9) }),
	ars(900_000, { direction: "IN", inType: "INCOME", categoryId: "salary" }),
	ars(50_000, { entryKind: "NOT_SPENDING" }),
	ars(70_000, {
		direction: "IN",
		entryKind: "STARTING_BALANCE",
		categoryId: null,
	}),
	ars(3_000, { entryKind: "ADJUSTMENT", categoryId: null }),
	ars(7_000, { excludeFromAnalytics: true }),
	ars(4_000, { status: "DRAFT" }),
	ars(120_000, { isAmortizedParent: true }),
	ars(500, { date: new Date("2026-04-02T12:00:00Z") }),
];

describe("figure spent", () => {
	let db: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useExpenseTable(db, LEDGER);
		shares.mockResolvedValue([]);
		hidden.mockResolvedValue(["hidden-project"]);
	});

	it("is your spending minus refunds, nothing else", async () => {
		// 12,000 spent - 2,000 refunded
		await expect(
			spentIn(db as never, { userId: USER, date: MARCH }, "ARS", 1000),
		).resolves.toBe(10_000);
	});

	it("nets refunds in their category as negative items", async () => {
		const items = await spentItems(
			db as never,
			{ userId: USER, date: MARCH },
			"category",
		);
		expect(items).toEqual([
			{
				currency: "ARS",
				amount: 12_000,
				amountInUSD: 12,
				categoryId: "groceries",
				date: null,
				count: 1,
			},
			{
				currency: "ARS",
				amount: -2_000,
				amountInUSD: -2,
				categoryId: "groceries",
				date: null,
				count: 0,
			},
		]);
	});

	it("adds your shares and leaves hidden projects to the share lookup", async () => {
		shares.mockResolvedValue([
			{
				amount: 20_000,
				currency: "ARS",
				amountInUSD: 20,
				categoryId: null,
				date: day(20),
			},
		]);
		const total = await spentIn(
			db as never,
			{ userId: USER, date: MARCH },
			"ARS",
			1000,
		);

		expect(total).toBe(30_000);
		expect(shares).toHaveBeenCalledWith(db, USER, MARCH, undefined, [
			"hidden-project",
		]);
	});

	it("filters shares by category like personal rows", async () => {
		shares.mockResolvedValue([
			{
				amount: 20_000,
				currency: "ARS",
				amountInUSD: 20,
				categoryId: null,
				date: day(20),
			},
			{
				amount: 1_000,
				currency: "ARS",
				amountInUSD: 1,
				categoryId: "groceries",
				date: day(21),
			},
		]);
		const total = await spentIn(
			db as never,
			{ userId: USER, date: MARCH, categoryIds: ["groceries"] },
			"ARS",
			1000,
		);
		expect(total).toBe(11_000);
	});

	it("counts hidden rows and every share on the budget basis", async () => {
		const total = await spentIn(
			db as never,
			{ userId: USER, date: MARCH, basis: "budget", excludedProjectIds: ["p"] },
			"ARS",
			1000,
		);
		// + the 7,000 hidden from reports; hidden projects are a reports flag only
		expect(total).toBe(17_000);
		expect(shares).toHaveBeenCalledWith(db, USER, MARCH, undefined, []);
	});

	it("skips shares for personal-only readers", async () => {
		await spentItems(db as never, { userId: USER, personalOnly: true });
		expect(shares).not.toHaveBeenCalled();
	});

	it("reads per currency in minor units, never converted", async () => {
		useExpenseTable(db, [
			...LEDGER,
			{ date: day(6), amount: 12.34, currency: "USD", amountInUSD: 12.34 },
		]);
		shares.mockResolvedValue([
			{
				amount: 0.5,
				currency: "USD",
				amountInUSD: 0.5,
				categoryId: null,
				date: day(7),
			},
		]);
		const lines = await spentByCurrency(db as never, {
			userId: USER,
			date: MARCH,
		});
		expect(lines).toEqual([
			{ minor: 1_000_000, currency: "ARS" }, // 10,000.00
			{ minor: 1_284, currency: "USD" }, // 12.34 + 0.50
		]);
	});

	it("rounds a sum more precise than its currency half to even", async () => {
		const usdRow = (amount: number) => ({
			date: day(6),
			amount,
			currency: "USD",
			amountInUSD: amount,
		});
		useExpenseTable(db, [usdRow(12.345)]);
		await expect(
			spentByCurrency(db as never, { userId: USER, date: MARCH }),
		).resolves.toEqual([{ minor: 1_234, currency: "USD" }]);

		useExpenseTable(db, [usdRow(12.355)]);
		await expect(
			spentByCurrency(db as never, { userId: USER, date: MARCH }),
		).resolves.toEqual([{ minor: 1_236, currency: "USD" }]);
	});

	it("drops a currency whose refunds cancel its spending", async () => {
		useExpenseTable(db, [
			ars(2_000),
			ars(2_000, { direction: "IN", inType: "REFUND" }),
		]);
		await expect(
			spentByCurrency(db as never, { userId: USER, date: MARCH }),
		).resolves.toEqual([]);
	});

	it("reads the running fiscal month for the figure", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
		try {
			db.user.findUnique.mockResolvedValue({ fiscalMonthStartDay: 1 });
			// Only the April 2 row is in the running month.
			await expect(
				spentFigure.compute(db as never, { userId: USER }),
			).resolves.toEqual([{ minor: 50_000, currency: "ARS" }]);
		} finally {
			vi.useRealTimers();
		}
	});
});
