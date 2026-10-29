import { agoOf, daysSince } from "./relative";

describe("daysSince", () => {
	it("counts calendar days, not hours", () => {
		const now = new Date(2026, 9, 29, 0, 5);
		expect(daysSince("2026-10-29", now)).toBe(0);
		expect(daysSince("2026-10-25", now)).toBe(4);
		expect(daysSince("2026-10-30", now)).toBe(0);
	});
});

describe("agoOf", () => {
	it("says today, days, weeks and months, and gives up after a year", () => {
		expect(agoOf(0)).toEqual({ unit: "today" });
		expect(agoOf(4)).toEqual({ unit: "days", count: 4 });
		expect(agoOf(9)).toEqual({ unit: "weeks", count: 1 });
		expect(agoOf(75)).toEqual({ unit: "months", count: 2 });
		expect(agoOf(400)).toBeNull();
	});
});
