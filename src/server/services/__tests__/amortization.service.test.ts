import { beforeEach, describe, expect, it } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { AmortizationService } from "../amortization.service";

type Child = {
	amount: string;
	amountInUSD: string;
	date: Date;
	excludeFromAnalytics: boolean;
	exchangeRate: string;
	rateType: string | null;
	homeCurrency?: string;
	homeRate?: string;
	homeAmount?: string;
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
		expect(children().map((c) => c.exchangeRate)).toEqual(["1560", "1560", "1560"]);
		// 192.31 USD = 19231 cents over 3: base 6410 and 1 left, which the first
		// part takes: 64.11 + 64.10 + 64.10.
		expect(children().map((c) => c.amountInUSD)).toEqual(["64.11", "64.10", "64.10"]);
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
			["blue", "ARS", "1480", "49333.34"],
			["blue", "ARS", "1480", "49333.33"],
			["blue", "ARS", "1480", "49333.33"],
		]);
	});

	it("children of a row with no booked home value book none", async () => {
		await service.syncAmortization(parent({ rateType: "official" }), 2);
		expect(children().every((c) => c.homeCurrency === undefined)).toBe(true);
		expect(children().every((c) => c.rateType === "official")).toBe(true);
	});

	it("splits crypto in satoshis: 0.003 BTC over 3 months is 0.001 each", () => {
		const splits = service.calculateSplits(new Date(2026, 0, 31), 0.003, 193.64, 3, "BTC");
		expect(splits.map((s) => s.amount)).toEqual(["0.00100000", "0.00100000", "0.00100000"]);
		// 193.64 USD = 19364 cents over 3: base 6454, 2 left for the first two.
		expect(splits.map((s) => s.amountInUSD)).toEqual(["64.55", "64.55", "64.54"]);
	});

	it("splits 3-decimal and 0-decimal fiat in their own units", () => {
		expect(
			service.calculateSplits(new Date(), 1, 3.22, 3, "KWD").map((s) => s.amount),
		).toEqual(["0.334", "0.333", "0.333"]);
		expect(
			service.calculateSplits(new Date(), 1000, 6.1, 3, "JPY").map((s) => s.amount),
		).toEqual(["334", "333", "333"]);
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

	it("parts add up to the principal exactly, with no float in the way", () => {
		// ARS 1,000,000.01 over 7 months: 100000001 cents = 14285714 x 7 + 3,
		// so three parts take a cent: 3 x 142857.15 + 4 x 142857.14 = 1000000.01.
		const splits = service.calculateSplits(
			new Date(2026, 0, 1),
			"1000000.01",
			"647.30",
			7,
			"ARS",
		);
		expect(splits.map((s) => s.amount)).toEqual([
			"142857.15",
			"142857.15",
			"142857.15",
			"142857.14",
			"142857.14",
			"142857.14",
			"142857.14",
		]);
		const cents = splits.reduce((sum, s) => sum + BigInt(s.amount.replace(".", "")), 0n);
		expect(cents).toBe(100000001n);
	});

	it("rounds a total more precise than the currency half to even before it splits", () => {
		// A stored 8 dp ARS amount of 100.005 is a half-cent tie: half even
		// keeps 100.00 (the lower neighbor is even), half up would give 100.01.
		// 100.00 over 3: 3333 cents x 3 + 1, so 33.34 + 33.33 + 33.33.
		const tie = service.calculateSplits(new Date(), "100.00500000", "1.005", 3, "ARS");
		expect(tie.map((s) => s.amount)).toEqual(["33.34", "33.33", "33.33"]);
		// USD 1.005 is a tie too: 100.5 cents, half even gives 100, so 0.34 + 0.33 + 0.33.
		expect(tie.map((s) => s.amountInUSD)).toEqual(["0.34", "0.33", "0.33"]);
	});

	it("the booked exchange rate is carried as exact text", async () => {
		await service.syncAmortization(parent({ exchangeRate: "1545.123456" }), 2);
		expect(children().map((c) => c.exchangeRate)).toEqual(["1545.123456", "1545.123456"]);
	});
});
