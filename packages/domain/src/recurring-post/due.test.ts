import { describe, expect, it } from "vitest";
import { isDue } from "./due";

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const TOKYO = "Asia/Tokyo";

describe("isDue with start_of_next_day", () => {
	// Buenos Aires is UTC-3: Jan 31 00:00 there is 03:00Z.
	const dueAtMidnight = new Date("2027-01-31T03:00:00Z");

	it("is due from the first instant of its day, not before it", () => {
		// One second before Jan 31 00:00 in Buenos Aires: still Jan 30.
		expect(
			isDue(
				dueAtMidnight,
				new Date("2027-01-31T02:59:59Z"),
				BUENOS_AIRES,
				"start_of_next_day",
			),
		).toBe(false);
		expect(
			isDue(
				dueAtMidnight,
				new Date("2027-01-31T03:00:00Z"),
				BUENOS_AIRES,
				"start_of_next_day",
			),
		).toBe(true);
	});

	it("reads the day in the zone it is given", () => {
		// 2027-01-31T20:00Z is Feb 1 05:00 in Tokyo and Jan 31 17:00 in Buenos Aires.
		const now = new Date("2027-01-31T20:00:00Z");
		const feb1Tokyo = new Date("2027-01-31T15:00:00Z");
		expect(isDue(feb1Tokyo, now, TOKYO, "start_of_next_day")).toBe(true);
		expect(
			isDue(
				new Date("2027-02-01T03:00:00Z"),
				now,
				BUENOS_AIRES,
				"start_of_next_day",
			),
		).toBe(false);
	});

	it("a due instant exactly at the start of the next day is not due", () => {
		// Now is Jan 31 12:00 in Buenos Aires; the next day starts at Feb 1 03:00Z.
		const now = new Date("2027-01-31T15:00:00Z");
		expect(
			isDue(
				new Date("2027-02-01T03:00:00Z"),
				now,
				BUENOS_AIRES,
				"start_of_next_day",
			),
		).toBe(false);
		expect(
			isDue(
				new Date("2027-02-01T02:59:59Z"),
				now,
				BUENOS_AIRES,
				"start_of_next_day",
			),
		).toBe(true);
	});
});

describe("isDue with utc_day", () => {
	// An income due day is a UTC midnight; it is due once that calendar day is today in the zone.
	const jan31 = new Date("2027-01-31T00:00:00Z");

	it("waits for the calendar day in the zone, west of UTC", () => {
		// Jan 31 01:00Z is still Jan 30 22:00 in Buenos Aires.
		const now = new Date("2027-01-31T01:00:00Z");
		expect(isDue(jan31, now, BUENOS_AIRES, "utc_day")).toBe(false);
		// ...while the start_of_next_day rule already calls the same period due.
		expect(isDue(jan31, now, BUENOS_AIRES, "start_of_next_day")).toBe(true);
	});

	it("is due once the zone's day reaches it, and for any earlier day", () => {
		// Jan 31 03:00Z is Jan 31 00:00 in Buenos Aires.
		expect(
			isDue(jan31, new Date("2027-01-31T03:00:00Z"), BUENOS_AIRES, "utc_day"),
		).toBe(true);
		expect(
			isDue(jan31, new Date("2027-02-05T12:00:00Z"), BUENOS_AIRES, "utc_day"),
		).toBe(true);
	});

	it("east of UTC the day arrives before the UTC day does", () => {
		// Jan 30 16:00Z is Jan 31 01:00 in Tokyo.
		expect(
			isDue(jan31, new Date("2027-01-30T16:00:00Z"), TOKYO, "utc_day"),
		).toBe(true);
	});
});
