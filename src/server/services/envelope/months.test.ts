import { describe, expect, it } from "vitest";
import {
	budgetMonthOf,
	isoDateIn,
	monthRange,
	monthsFrom,
	startDayFor,
} from "./months";

const FIRST = [{ fromMonth: 202601, startDay: 1 }];
/** C20: the start day moves from the 1st to the 25th from November 2026 on. */
const MOVED = [
	{ fromMonth: 202601, startDay: 1 },
	{ fromMonth: 202611, startDay: 25 },
];

describe("budget months (SPEC §5.1, C20, C21)", () => {
	it("calendar months when the start day is the 1st", () => {
		expect(monthRange(202610, FIRST)).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(monthRange(202602, FIRST)).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
	});

	it("no period reads as the 1st", () => {
		expect(startDayFor(202610, [])).toBe(1);
	});

	it("C20: the month that straddles a start-day change runs longer; past months stay put", () => {
		// November now starts on the 25th, so October runs to Nov 24.
		expect(monthRange(202610, MOVED)).toEqual({
			from: "2026-10-01",
			to: "2026-11-24",
		});
		expect(monthRange(202609, MOVED)).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(budgetMonthOf("2026-11-10", MOVED)).toBe(202610);
	});

	it("C20: the first month under the new start day", () => {
		expect(monthRange(202611, MOVED)).toEqual({
			from: "2026-11-25",
			to: "2026-12-24",
		});
	});

	it("C21: a date belongs to the month whose range contains it", () => {
		const s25 = [{ fromMonth: 202601, startDay: 25 }];
		expect(budgetMonthOf("2026-10-24", s25)).toBe(202609);
		expect(budgetMonthOf("2026-10-25", s25)).toBe(202610);
		expect(budgetMonthOf("2026-11-24", s25)).toBe(202610);
		expect(budgetMonthOf("2026-01-03", s25)).toBe(202512);
		expect(budgetMonthOf("2026-10-31", FIRST)).toBe(202610);
	});

	it("isoDateIn reads the wall date in the zone", () => {
		// 01:30 UTC on Nov 1 is still Oct 31 in Buenos Aires (UTC-3).
		const instant = new Date("2026-11-01T01:30:00Z");
		expect(isoDateIn(instant, "America/Argentina/Buenos_Aires")).toBe(
			"2026-10-31",
		);
		expect(isoDateIn(instant, "UTC")).toBe("2026-11-01");
	});

	it("monthsFrom crosses a year", () => {
		expect(monthsFrom(202611, 202702)).toEqual([
			202611, 202612, 202701, 202702,
		]);
	});
});
