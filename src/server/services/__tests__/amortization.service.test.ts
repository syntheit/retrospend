import { beforeEach, describe, expect, it } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { AmortizationService } from "../amortization.service";

type Child = {
	amount: number;
	amountInUSD: number;
	date: Date;
	excludeFromAnalytics: boolean;
	exchangeRate: number;
	rateType: string | null;
	homeCurrency?: string;
	homeRate?: string;
	homeAmount?: number;
};

describe("AmortizationService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: AmortizationService;

	beforeEach(() => {
		db = createMockDb();
		service = new AmortizationService(db as never);
	});

	const parent = (overrides: Record<string, unknown> = {}) => ({
		id: "parent-1",
		userId: "user-1",
		title: "Laptop",
		amount: 1200,
		amountInUSD: 1200,
		currency: "USD",
		exchangeRate: 1,
		pricingSource: "MANUAL",
		date: new Date(2026, 0, 31, 12),
		categoryId: null,
		...overrides,
	});

	const children = () =>
		(db.expense.createMany.mock.calls[0]![0] as { data: Child[] }).data;

	it("children inherit excludeFromAnalytics from the parent", async () => {
		await service.syncAmortization(parent({ excludeFromAnalytics: true }), 3);
		expect(children()).toHaveLength(3);
		expect(children().every((c) => c.excludeFromAnalytics)).toBe(true);
	});

	it("children of an included parent stay included", async () => {
		await service.syncAmortization(parent({ excludeFromAnalytics: false }), 2);
		expect(children().every((c) => !c.excludeFromAnalytics)).toBe(true);
	});

	it("children carry the parent's rate", async () => {
		await service.syncAmortization(
			parent({ currency: "ARS", amount: 300000, amountInUSD: 192.31, exchangeRate: 1560 }),
			3,
		);
		expect(children().map((c) => c.exchangeRate)).toEqual([1560, 1560, 1560]);
		expect(children().reduce((s, c) => s + c.amountInUSD, 0)).toBeCloseTo(192.31, 8);
	});

	it("children split the booked home value and keep its rate (2A.2)", async () => {
		// USD 100 booked at ARS 1,480: ARS 148,000.00 over 3 parts is
		// 49,333.34 + 49,333.33 + 49,333.33 (the first part takes the cent).
		await service.syncAmortization(
			parent({
				amount: 100,
				amountInUSD: 100,
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1480",
				homeAmount: "148000.00",
			}),
			3,
		);
		expect(
			children().map((c) => [
				c.rateType,
				c.homeCurrency,
				c.homeRate,
				c.homeAmount,
			]),
		).toEqual([
			["blue", "ARS", "1480", 49333.34],
			["blue", "ARS", "1480", 49333.33],
			["blue", "ARS", "1480", 49333.33],
		]);
	});

	it("children of a row with no booked home value book none", async () => {
		await service.syncAmortization(parent({ rateType: "official" }), 2);
		expect(children().every((c) => c.homeCurrency === undefined)).toBe(true);
		expect(children().every((c) => c.rateType === "official")).toBe(true);
	});

	it("splits crypto in satoshis: 0.003 BTC over 3 months is 0.001 each", () => {
		const splits = service.calculateSplits(new Date(2026, 0, 31), 0.003, 193.64, 3, "BTC");
		expect(splits.map((s) => s.amount)).toEqual([0.001, 0.001, 0.001]);
		expect(splits.reduce((s, x) => s + x.amountInUSD, 0)).toBeCloseTo(193.64, 8);
	});

	it("splits 3-decimal and 0-decimal fiat in their own units", () => {
		expect(
			service.calculateSplits(new Date(), 1, 3.22, 3, "KWD").map((s) => s.amount),
		).toEqual([0.334, 0.333, 0.333]);
		expect(
			service.calculateSplits(new Date(), 1000, 6.1, 3, "JPY").map((s) => s.amount),
		).toEqual([334, 333, 333]);
	});

	it("month dates clamp from the 31st", () => {
		const splits = service.calculateSplits(new Date(2026, 0, 31), 4, 4, 4);
		expect(splits.map((s) => `${s.date.getMonth() + 1}/${s.date.getDate()}`)).toEqual([
			"1/31",
			"2/28",
			"3/31",
			"4/30",
		]);
	});
});
