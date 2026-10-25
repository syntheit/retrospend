import { describe, expect, it } from "vitest";
import {
	addDays,
	averageMinor,
	daysIn,
	monthsTouched,
	percentChange,
	previousSpan,
	savingsRatePercent,
	shiftMonthStart,
	yearBefore,
	yearToDate,
} from "./insights";

describe("previousSpan", () => {
	it("a whole month compares with the whole month before", () => {
		expect(previousSpan({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		// March (31 days) against February (28, then 29 in a leap year).
		expect(previousSpan({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
		expect(previousSpan({ from: "2028-03-01", to: "2028-03-31" })).toEqual({
			from: "2028-02-01",
			to: "2028-02-29",
		});
	});

	it("January looks back across the year", () => {
		expect(previousSpan({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
			from: "2025-12-01",
			to: "2025-12-31",
		});
	});

	it("any other span compares with the same number of days right before", () => {
		expect(previousSpan({ from: "2026-10-10", to: "2026-10-16" })).toEqual({
			from: "2026-10-03",
			to: "2026-10-09",
		});
	});

	it("a span across a month boundary keeps its length", () => {
		// 7 days from Nov 28 to Dec 4: the 7 days before are Nov 21 to Nov 27.
		expect(previousSpan({ from: "2026-11-28", to: "2026-12-04" })).toEqual({
			from: "2026-11-21",
			to: "2026-11-27",
		});
		// 4 days from Mar 2 to Mar 5: Feb 26 to Mar 1 (28-day February).
		expect(previousSpan({ from: "2026-03-02", to: "2026-03-05" })).toEqual({
			from: "2026-02-26",
			to: "2026-03-01",
		});
	});

	it("a month that does not start on the 1st is not a whole month", () => {
		// Oct 15 to Nov 14 is 31 days: Sep 14 to Oct 14.
		expect(previousSpan({ from: "2026-10-15", to: "2026-11-14" })).toEqual({
			from: "2026-09-14",
			to: "2026-10-14",
		});
	});
});

describe("year to date", () => {
	it("January 1 to today against the same span last year", () => {
		expect(yearToDate("2026-10-24")).toEqual({
			thisYear: { from: "2026-01-01", to: "2026-10-24" },
			lastYear: { from: "2025-01-01", to: "2025-10-24" },
		});
	});

	it("February 29 has no twin in a common year", () => {
		expect(yearBefore("2028-02-29")).toBe("2027-02-28");
		expect(yearToDate("2028-02-29").lastYear.to).toBe("2027-02-28");
		expect(yearBefore("2025-03-01")).toBe("2024-03-01");
	});
});

describe("day math", () => {
	it("counts, shifts and touches months", () => {
		expect(daysIn({ from: "2026-02-15", to: "2026-03-14" })).toBe(28);
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(shiftMonthStart("2026-01-20", -1)).toBe("2025-12-01");
		expect(shiftMonthStart("2026-11-05", 3)).toBe("2027-02-01");
		expect(monthsTouched({ from: "2026-10-24", to: "2026-11-02" })).toBe(2);
		expect(monthsTouched({ from: "2026-01-01", to: "2026-10-24" })).toBe(10);
		expect(monthsTouched({ from: "2025-11-30", to: "2026-01-01" })).toBe(3);
	});
});

describe("ratios", () => {
	it("percent change is signed whole percent, half to even", () => {
		expect(percentChange(150, 100)).toBe(50);
		expect(percentChange(50, 100)).toBe(-50);
		expect(percentChange(1, 3)).toBe(-67); // -66.67
		expect(percentChange(201, 200)).toBe(0); // 0.5 goes to the even 0
		expect(percentChange(203, 200)).toBe(2); // 1.5 goes to the even 2
		expect(percentChange(197, 200)).toBe(-2); // -1.5 goes to -2
		expect(percentChange(199, 200)).toBe(0); // -0.5 is 0, never -0
		expect(Object.is(percentChange(199, 200), -0)).toBe(false);
	});

	it("nothing to compare with is null, not a percent of nothing", () => {
		expect(percentChange(500, 0)).toBeNull();
		expect(percentChange(0, 0)).toBeNull();
		expect(percentChange(500, -20)).toBeNull();
	});

	it("an average rounds half to even", () => {
		expect(averageMinor(10, 4)).toBe(2); // 2.5
		expect(averageMinor(14, 4)).toBe(4); // 3.5
		expect(averageMinor(-10, 4)).toBe(-2);
		expect(averageMinor(0, 7)).toBe(0);
		expect(() => averageMinor(10, 0)).toThrow(RangeError);
	});

	it("savings rate is the share of income left", () => {
		expect(savingsRatePercent(1000, 750)).toBe(25);
		expect(savingsRatePercent(1000, 1100)).toBe(-10);
		expect(savingsRatePercent(1000, 667)).toBe(33); // 33.3
		expect(savingsRatePercent(8, 7)).toBe(12); // 12.5 goes to the even 12
		expect(savingsRatePercent(0, 50)).toBeNull();
	});

	it("keeps exact math past what a float holds", () => {
		const big = 90_071_992_547_409; // 9e13 minor units
		expect(percentChange(big * 2, big)).toBe(100);
	});
});
