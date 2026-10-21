import { describe, expect, it } from "vitest";
import {
	budgetPeriod,
	getCurrentFiscalMonth,
	getFiscalMonthProgress,
	getFiscalMonthRange,
	shiftMonth,
} from "../fiscal-month";
import {
	calendarDaysBetween,
	dayKey,
	fromWallTime,
	normalizeTimeZone,
	startOfDayIn,
	wallTime,
} from "../time-zone";

const BA = "America/Argentina/Buenos_Aires"; // UTC-3, no DST
const BERLIN = "Europe/Berlin"; // UTC+1 / UTC+2
const NY = "America/New_York";

describe("time-zone helpers", () => {
	it("normalizeTimeZone accepts IANA names and rejects junk", () => {
		expect(normalizeTimeZone(BA)).toBe(BA);
		expect(normalizeTimeZone("UTC")).toBe("UTC");
		expect(normalizeTimeZone("Not/AZone")).toBeUndefined();
		expect(normalizeTimeZone("")).toBeUndefined();
		expect(normalizeTimeZone(42)).toBeUndefined();
	});

	it("wallTime reads the clock in the zone", () => {
		const instant = new Date("2026-11-01T01:30:00Z");
		expect(wallTime(instant, BA)).toMatchObject({
			year: 2026,
			month: 9,
			day: 31,
			hour: 22,
			minute: 30,
		});
		expect(wallTime(instant, "UTC")).toMatchObject({ month: 10, day: 1 });
	});

	it("fromWallTime is the inverse of wallTime, including over DST", () => {
		expect(
			fromWallTime({ year: 2026, month: 9, day: 1 }, BA).toISOString(),
		).toBe("2026-10-01T03:00:00.000Z");
		expect(
			fromWallTime({ year: 2026, month: 6, day: 1 }, BERLIN).toISOString(),
		).toBe("2026-06-30T22:00:00.000Z");
		expect(
			fromWallTime({ year: 2026, month: 0, day: 1 }, BERLIN).toISOString(),
		).toBe("2025-12-31T23:00:00.000Z");
		// Day after the US spring-forward change.
		expect(
			fromWallTime({ year: 2026, month: 2, day: 9 }, NY).toISOString(),
		).toBe("2026-03-09T04:00:00.000Z");
	});

	it("fromWallTime rolls months over like the Date constructor", () => {
		expect(
			fromWallTime({ year: 2026, month: 12, day: 1 }, BA).toISOString(),
		).toBe("2027-01-01T03:00:00.000Z");
		expect(
			fromWallTime({ year: 2026, month: 2, day: 0 }, BA).toISOString(),
		).toBe("2026-02-28T03:00:00.000Z");
	});

	it("dayKey and startOfDayIn use the zone's calendar day", () => {
		const lateEvening = new Date("2026-11-01T01:30:00Z");
		expect(dayKey(lateEvening, BA)).toBe("2026-10-31");
		expect(dayKey(lateEvening, "UTC")).toBe("2026-11-01");
		expect(startOfDayIn(lateEvening, BA).toISOString()).toBe(
			"2026-10-31T03:00:00.000Z",
		);
	});

	it("calendarDaysBetween counts days, not 24h blocks", () => {
		// March 2026 in New York has a 23 hour day.
		const start = fromWallTime({ year: 2026, month: 2, day: 1 }, NY);
		const end = fromWallTime({ year: 2026, month: 2, day: 31, hour: 23 }, NY);
		expect(calendarDaysBetween(start, end, NY)).toBe(30);
	});
});

describe("fiscal month in a time zone", () => {
	it("a late-evening expense in Buenos Aires stays in its local month", () => {
		const range = getFiscalMonthRange(new Date("2026-10-15T12:00:00Z"), 1, BA);
		expect(range.start.toISOString()).toBe("2026-10-01T03:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-11-01T02:59:59.999Z");
		const oct31Late = new Date("2026-11-01T01:30:00Z"); // 22:30 Oct 31 local
		expect(oct31Late >= range.start && oct31Late <= range.end).toBe(true);
	});

	it("reads the month label in the zone (UTC+ client midnight label)", () => {
		// Browser in Berlin sends local midnight Oct 1 = Sep 30 22:00Z.
		const label = new Date("2026-09-30T22:00:00Z");
		const range = getFiscalMonthRange(label, 1, BERLIN);
		expect(range.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-10-31T22:59:59.999Z");
		expect(budgetPeriod(label, BERLIN)).toEqual(new Date(2026, 9, 1));
	});

	it("custom start day uses local midnights", () => {
		const range = getFiscalMonthRange(new Date("2026-03-20T12:00:00Z"), 15, BA);
		expect(range.start.toISOString()).toBe("2026-03-15T03:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-04-15T02:59:59.999Z");
	});

	it("getCurrentFiscalMonth classifies by the local day", () => {
		const now = new Date("2026-11-01T01:30:00Z"); // Oct 31 local
		expect(getCurrentFiscalMonth(now, 1, BA).toISOString()).toBe(
			"2026-10-01T03:00:00.000Z",
		);
		expect(getCurrentFiscalMonth(now, 1, "UTC").toISOString()).toBe(
			"2026-11-01T00:00:00.000Z",
		);
		// Day 14 with start day 15 belongs to the previous period.
		const mid = new Date("2026-11-14T15:00:00Z");
		expect(getCurrentFiscalMonth(mid, 15, BA).toISOString()).toBe(
			"2026-10-01T03:00:00.000Z",
		);
	});

	it("shiftMonth steps calendar months from the 1st", () => {
		const label = new Date("2026-09-30T22:00:00Z"); // Oct 1 Berlin
		expect(shiftMonth(label, 1, BERLIN).toISOString()).toBe(
			"2026-10-31T23:00:00.000Z",
		);
		expect(shiftMonth(label, -1, BERLIN).toISOString()).toBe(
			"2026-08-31T22:00:00.000Z",
		);
		expect(shiftMonth(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 1));
		expect(shiftMonth(new Date(2026, 2, 31), -1)).toEqual(new Date(2026, 1, 1));
	});

	it("progress counts local days", () => {
		const now = new Date("2026-11-01T01:30:00Z"); // Oct 31 22:30 local
		const progress = getFiscalMonthProgress(
			now,
			new Date("2026-10-10T12:00:00Z"),
			1,
			BA,
		);
		expect(progress).toEqual({
			daysInPeriod: 31,
			currentDay: 31,
			daysRemaining: 1,
			isCurrentPeriod: true,
		});
	});

	it("a month with a DST change still has its calendar day count", () => {
		const progress = getFiscalMonthProgress(
			new Date("2027-01-01T00:00:00Z"),
			new Date("2026-03-15T12:00:00Z"),
			1,
			NY,
		);
		expect(progress.daysInPeriod).toBe(31);
	});
});
