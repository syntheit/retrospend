/**
 * The `spent` compute on rows held in memory, with every expected value
 * derived by hand. The same rules run on Postgres in
 * src/server/services/figures/spent.pg.test.ts, which holds the two loaders to
 * each other.
 */
import { describe, expect, it } from "vitest";
import { MissingRateError, sumInDec } from "./money-dec";
import { roundedMinor } from "./money-minor";
import {
	type SpentExpenseRow,
	type SpentShareRow,
	spentInputsFromRows,
	spentItemsOf,
	spentMinorByCurrency,
	spentRange,
} from "./spent";

const WIDE = {
	start: new Date("2000-01-01T00:00:00Z"),
	end: new Date("2100-01-01T00:00:00Z"),
};

const row = (o: Partial<SpentExpenseRow> = {}): SpentExpenseRow => ({
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	isAmortizedParent: false,
	excludeFromAnalytics: false,
	categoryKind: "EXPENSE",
	date: new Date("2026-10-10T12:00:00Z"),
	currency: "ARS",
	amount: "0",
	amountInUSD: "0",
	homeCurrency: null,
	homeAmount: null,
	...o,
});

const share = (o: Partial<SpentShareRow> = {}): SpentShareRow => ({
	shareAmount: "0",
	verificationStatus: "PENDING",
	currency: "ARS",
	date: new Date("2026-10-10T12:00:00Z"),
	projectId: null,
	exchangeRate: null,
	categoryId: null,
	...o,
});

const figure = (
	expenses: SpentExpenseRow[],
	shares: SpentShareRow[] = [],
	range = WIDE,
) =>
	spentMinorByCurrency(
		spentInputsFromRows({
			expenses,
			shares,
			hiddenProjectIds: ["hidden"],
			range,
		}),
	);

describe("spent on rows in memory", () => {
	it("counts spending and shares, nets refunds, and leaves out everything else", () => {
		const out = { amount: "100", amountInUSD: "0" };
		// 100 spent + 40 + 9 in shares - 30 refunded = 119.00 ARS
		expect(
			figure(
				[
					row(out),
					row({ amount: "30", direction: "IN", inType: "REFUND" }),
					row({ ...out, direction: "IN", inType: "INCOME" }),
					row({ ...out, entryKind: "NOT_SPENDING" }),
					row({ ...out, entryKind: "STARTING_BALANCE", direction: "IN" }),
					row({ ...out, entryKind: "ADJUSTMENT" }),
					row({ ...out, status: "DRAFT" }),
					row({ ...out, excludeFromAnalytics: true }),
					// Refunds that fail exactly one clause each.
					...[
						{ excludeFromAnalytics: true },
						{ status: "DRAFT" },
						{ categoryKind: "INCOME" },
						{ entryKind: "NOT_SPENDING" },
						{ inType: "INCOME" },
						{ direction: "OUT", isAmortizedParent: true },
					].map((o) =>
						row({ amount: "30", direction: "IN", inType: "REFUND", ...o }),
					),
					row({ ...out, isAmortizedParent: true }),
					row({ ...out, categoryKind: "INCOME" }),
				],
				[
					share({ shareAmount: "40" }),
					share({ shareAmount: "7", verificationStatus: "REJECTED" }),
					share({ shareAmount: "8", projectId: "hidden" }),
					share({ shareAmount: "9", projectId: "shown" }),
				],
			),
		).toEqual([{ minor: 11_900, currency: "ARS" }]);
	});

	it("keeps a currency's minor units: JPY has none, KWD has three", () => {
		expect(
			figure([
				row({ currency: "JPY", amount: "1234" }),
				row({ currency: "JPY", amount: "766" }),
				row({ currency: "KWD", amount: "12.345" }),
				row({ currency: "KWD", amount: "0.001" }),
			]),
		).toEqual([
			{ minor: 2_000, currency: "JPY" },
			{ minor: 12_346, currency: "KWD" },
		]);
	});

	it("rounds a legacy sum more precise than its currency half to even, group by group", () => {
		// KWD 1.2345 -> 1.234 (the 4 is even), 1.2355 -> 1.236.
		expect(
			figure([
				row({ currency: "KWD", amount: "1.2345" }),
				row({ currency: "KWD", amount: "1.2355", homeCurrency: "ARS" }),
			]),
		).toEqual([{ minor: 1_234 + 1_236, currency: "KWD" }]);
		// Two groups of USD 0.005 each round to 0.00; a merged 0.010 would be 0.01.
		expect(
			figure([
				row({ currency: "USD", amount: "0.005" }),
				row({ currency: "USD", amount: "0.005", homeCurrency: "ARS" }),
			]),
		).toEqual([]);
	});

	it("sums exactly, with no float step", () => {
		// 0.1 + 0.2 + 0.7 is 0.9999999999999999 as floats; exactly 1.00.
		expect(
			figure(
				["0.1", "0.2", "0.7"].map((amount) => row({ currency: "USD", amount })),
			),
		).toEqual([{ minor: 100, currency: "USD" }]);
	});

	it("drops a currency whose refunds cancel its spending", () => {
		expect(
			figure([
				row({ amount: "2000" }),
				row({ amount: "2000", direction: "IN", inType: "REFUND" }),
			]),
		).toEqual([]);
	});

	describe("the month in the user's zone", () => {
		const now = new Date("2026-10-15T12:00:00Z");
		const early = row({
			amount: "1000.50",
			date: new Date("2026-10-01T01:30:00Z"),
		});
		const late = row({
			amount: "250.25",
			date: new Date("2026-11-01T01:30:00Z"),
		});
		const mid = row({
			amount: "10000",
			date: new Date("2026-10-15T12:00:00Z"),
		});
		const read = (zone: string, startDay = 1) =>
			figure([early, late, mid], [], spentRange(now, startDay, zone));

		it("UTC October holds the 01:30Z row on the 1st but not the one on Nov 1", () => {
			// 1,000.50 + 10,000.00
			expect(read("UTC")).toEqual([{ minor: 1_100_050, currency: "ARS" }]);
		});

		it("Buenos Aires October starts at 03:00Z: the first row is September 30 there", () => {
			// 250.25 + 10,000.00
			expect(read("America/Argentina/Buenos_Aires")).toEqual([
				{ minor: 1_025_025, currency: "ARS" },
			]);
		});

		it("both ends are inclusive", () => {
			const zone = "America/Argentina/Buenos_Aires";
			const { start, end } = spentRange(now, 1, zone);
			expect(start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
			expect(end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
			expect(
				figure(
					[row({ amount: "1", date: start }), row({ amount: "2", date: end })],
					[],
					{ start, end },
				),
			).toEqual([{ minor: 300, currency: "ARS" }]);
		});

		it("a start day of 15 reads the running month from the 15th", () => {
			expect(spentRange(now, 15, "UTC").start.toISOString()).toBe(
				"2026-10-15T00:00:00.000Z",
			);
			expect(
				spentRange(
					new Date("2026-10-14T12:00:00Z"),
					15,
					"UTC",
				).start.toISOString(),
			).toBe("2026-09-15T00:00:00.000Z");
		});
	});

	describe("totals in a home currency (ARS blue 1,500)", () => {
		// USD 100 booked at blue 1,500 = ARS 150,000; ARS 30,000 (USD 20 at 1,500);
		// a refund of ARS 15,000 (USD 10); a share of ARS 75,000 saved at blue
		// 1,500 (USD 50).
		const inputs = () =>
			spentInputsFromRows({
				expenses: [
					row({
						currency: "USD",
						amount: "100",
						amountInUSD: "100",
						homeCurrency: "ARS",
						homeAmount: "150000",
					}),
					row({ amount: "30000", amountInUSD: "20" }),
					row({
						amount: "15000",
						amountInUSD: "10",
						direction: "IN",
						inType: "REFUND",
					}),
				],
				shares: [share({ shareAmount: "75000", exchangeRate: "1500" })],
				hiddenProjectIds: [],
				range: WIDE,
			});

		it("sums in ARS at the booked and own values, in USD at the USD values", () => {
			const items = spentItemsOf(inputs());
			// 150,000 booked + 30,000 - 15,000 + 75,000
			expect(sumInDec(items, "ARS", 1500).toFixed()).toBe("240000");
			// 100 + 20 - 10 + 50
			expect(sumInDec(items, "USD", 1).toFixed()).toBe("160");
			expect(spentMinorByCurrency(inputs())).toEqual([
				{ minor: 10_000, currency: "USD" },
				{ minor: 9_000_000, currency: "ARS" },
			]);
		});

		it("a share in a currency with no rate stays in its own currency and names itself missing elsewhere", () => {
			const unpriced = spentInputsFromRows({
				expenses: [],
				shares: [share({ shareAmount: "500", currency: "XQZ" })],
				hiddenProjectIds: [],
				range: WIDE,
			});
			expect(unpriced.shares[0]?.amountInUSD).toBeNull();
			expect(sumInDec(spentItemsOf(unpriced), "XQZ", 3).toFixed()).toBe("500");
			expect(() => sumInDec(spentItemsOf(unpriced), "ARS", 1500)).toThrow(
				MissingRateError,
			);
			expect(spentMinorByCurrency(unpriced)).toEqual([
				{ minor: 50_000, currency: "XQZ" },
			]);
		});

		it("a home currency with no rate throws, never 1", () => {
			expect(() => sumInDec(spentItemsOf(inputs()), "EUR", null)).toThrow(
				MissingRateError,
			);
		});

		it("a share's USD value stays exact text, never rounded to cents", () => {
			const exact = spentInputsFromRows({
				expenses: [],
				shares: [
					// 28.5 ARS at 100 per USD = 0.285 USD, half a cent that a cents
					// round would decide; 12.73333333 USD at the USD rate of 1.
					share({ shareAmount: "28.5", exchangeRate: "100" }),
					share({ shareAmount: "12.73333333", currency: "USD" }),
				],
				hiddenProjectIds: [],
				range: WIDE,
			});
			expect(exact.shares.map((s) => s.amountInUSD)).toEqual([
				"0.285",
				"12.73333333",
			]);
			// In a USD home the two add to 13.01833333 exactly, 1302 cents once.
			const total = sumInDec(spentItemsOf(exact), "USD", 1);
			expect(total.toFixed()).toBe("13.01833333");
			expect(roundedMinor(total, "USD")).toBe(1302);
		});

		it("shares total from their amount and rate, so a true tie rounds half even", () => {
			const inputs = spentInputsFromRows({
				expenses: [],
				shares: [
					share({ shareAmount: "1", currency: "EUR", exchangeRate: "13" }),
					share({ shareAmount: "1", currency: "EUR", exchangeRate: "13" }),
				],
				hiddenProjectIds: [],
				range: WIDE,
			});
			expect(inputs.shares.map((s) => s.rate)).toEqual(["13", "13"]);
			// Each is 22.75 / 13 = 1.75 JPY; together 3.5, a tie: 4 is even. A
			// total through the USD quotient (0.0769230...) gave 3.4999...9, 3.
			const total = sumInDec(spentItemsOf(inputs), "JPY", 22.75);
			expect(total.toFixed()).toBe("3.5");
			expect(roundedMinor(total, "JPY")).toBe(4);
		});

		it("a refund of nothing is zero, never -0", () => {
			const zero = spentInputsFromRows({
				expenses: [
					row({
						amount: "0",
						amountInUSD: "0",
						direction: "IN",
						inType: "REFUND",
					}),
				],
				shares: [],
				hiddenProjectIds: [],
				range: WIDE,
			});
			expect(spentItemsOf(zero)[0]?.amount.toFixed()).toBe("0");
		});
	});
});
