import { describe, expect, it } from "vitest";
import { monthSpan } from "../preferences/month-span";

// Local dates: the hint is about the viewer's own calendar.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe("monthSpan", () => {
	it("is the calendar month when the month starts on the 1st", () => {
		expect(monthSpan(day(2026, 10, 22), 1)).toEqual({
			start: "2026-10-01",
			end: "2026-10-31",
		});
	});

	it("runs from the start day to the day before it next month", () => {
		expect(monthSpan(day(2026, 10, 22), 15)).toEqual({
			start: "2026-10-15",
			end: "2026-11-14",
		});
	});

	it("belongs to the previous month before the start day", () => {
		expect(monthSpan(day(2026, 10, 10), 15)).toEqual({
			start: "2026-09-15",
			end: "2026-10-14",
		});
	});

	it("crosses the year", () => {
		expect(monthSpan(day(2027, 1, 3), 28)).toEqual({
			start: "2026-12-28",
			end: "2027-01-27",
		});
	});

	it("handles February", () => {
		expect(monthSpan(day(2027, 2, 10), 1)).toEqual({
			start: "2027-02-01",
			end: "2027-02-28",
		});
	});
});
