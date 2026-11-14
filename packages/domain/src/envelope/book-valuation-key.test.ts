/**
 * The key changes with each thing a book's valuations depend on and with
 * nothing else: one test per field, plus the period list as a whole.
 */
import { describe, expect, it } from "vitest";
import { bookValuationKey, type ValuationBook } from "./book-valuation-key";

type Period = ValuationBook["periods"][number];

const first: Period = { fromMonth: 202610, startDay: 5, rateType: "blue" };
const second: Period = { fromMonth: 202701, startDay: 1, rateType: "official" };

const base: ValuationBook = {
	currency: "ARS",
	timeZone: "America/Argentina/Buenos_Aires",
	startDate: new Date("2026-10-05T03:00:00Z"),
	periods: [first, second],
};

const key = (o: Partial<ValuationBook> = {}) =>
	bookValuationKey({ ...base, ...o });

describe("bookValuationKey", () => {
	it("is the same for the same book, however its periods came back", () => {
		expect(key()).toBe(key());
		expect(key({ periods: [second, first] })).toBe(key());
		// A copy with the same values, not the same objects.
		expect(
			key({
				periods: [{ ...first }, { ...second }],
				startDate: new Date(base.startDate.getTime()),
			}),
		).toBe(key());
	});

	it("changes with the currency", () => {
		expect(key({ currency: "USD" })).not.toBe(key());
	});

	it("changes with the zone", () => {
		expect(key({ timeZone: "UTC" })).not.toBe(key());
	});

	it("changes with the start date", () => {
		expect(key({ startDate: new Date("2026-10-06T03:00:00Z") })).not.toBe(
			key(),
		);
	});

	it("changes with the month a period takes effect", () => {
		expect(
			key({ periods: [{ ...first, fromMonth: 202611 }, second] }),
		).not.toBe(key());
	});

	it("changes with a period's start day", () => {
		expect(key({ periods: [{ ...first, startDay: 6 }, second] })).not.toBe(
			key(),
		);
	});

	it("changes with a period's rate type", () => {
		expect(key({ periods: [first, { ...second, rateType: "blue" }] })).not.toBe(
			key(),
		);
	});

	it("changes when a period is added or removed", () => {
		const third: Period = { fromMonth: 202801, startDay: 1, rateType: "blue" };
		expect(key({ periods: [first, second, third] })).not.toBe(key());
		expect(key({ periods: [first] })).not.toBe(key());
	});

	it("keeps month, start day and rate type apart", () => {
		// Joined without separators these two would read the same.
		const a = key({
			periods: [{ fromMonth: 202701, startDay: 5, rateType: "0blue" }],
		});
		const b = key({
			periods: [{ fromMonth: 202701, startDay: 50, rateType: "blue" }],
		});
		expect(a).not.toBe(b);
	});
});
