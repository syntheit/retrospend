import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	dueAnchorDay,
	nextDueAfter,
	nextDueDay,
	nextRecurringDate,
} from "./recurring";
import { dayKey, parseDateOnlyIn } from "./time-zone";

const NEW_YORK = "America/New_York";
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const AUCKLAND = "Pacific/Auckland";
const TOKYO = "Asia/Tokyo";

const at = (day: string, zone: string) => parseDateOnlyIn(day, zone);
const iso = (date: Date) => date.toISOString();

describe("nextRecurringDate in a zone", () => {
	it("anchor 31 walks Jan 31, Feb 28, Mar 31, Apr 30 at New York midnight", () => {
		// Midnight EST is 05:00Z; DST starts Mar 14 2027, so midnight EDT is 04:00Z.
		let due = at("2027-01-31", NEW_YORK);
		const seen: string[] = [];
		for (let i = 0; i < 3; i++) {
			due = nextRecurringDate(due, "MONTHLY", 31, NEW_YORK);
			seen.push(iso(due));
		}
		expect(seen).toEqual([
			"2027-02-28T05:00:00.000Z",
			"2027-03-31T04:00:00.000Z",
			"2027-04-30T04:00:00.000Z",
		]);
	});

	it("anchor 31 steps the same days east of UTC, where midnight is the day before in UTC", () => {
		// Midnight NZDT (UTC+13) on Jan 31 is Jan 30 11:00Z.
		const feb = nextRecurringDate(
			at("2027-01-31", AUCKLAND),
			"MONTHLY",
			31,
			AUCKLAND,
		);
		expect(iso(feb)).toBe("2027-02-27T11:00:00.000Z");
		expect(dayKey(feb, AUCKLAND)).toBe("2027-02-28");
		const mar = nextRecurringDate(feb, "MONTHLY", 31, AUCKLAND);
		expect(dayKey(mar, AUCKLAND)).toBe("2027-03-31");
	});

	it("a 30-day month and the leap February", () => {
		const may = nextRecurringDate(
			at("2027-04-30", BUENOS_AIRES),
			"MONTHLY",
			31,
			BUENOS_AIRES,
		);
		expect(iso(may)).toBe("2027-05-31T03:00:00.000Z");
		const feb = nextRecurringDate(
			at("2028-01-31", BUENOS_AIRES),
			"MONTHLY",
			31,
			BUENOS_AIRES,
		);
		expect(iso(feb)).toBe("2028-02-29T03:00:00.000Z");
	});

	it("quarterly and yearly clamp to the month end", () => {
		const q = nextRecurringDate(
			at("2026-11-30", NEW_YORK),
			"QUARTERLY",
			30,
			NEW_YORK,
		);
		expect(iso(q)).toBe("2027-02-28T05:00:00.000Z");
		const y = nextRecurringDate(
			at("2028-02-29", NEW_YORK),
			"YEARLY",
			29,
			NEW_YORK,
		);
		expect(iso(y)).toBe("2029-02-28T05:00:00.000Z");
	});

	it("without an anchor the date's own day in the zone is the anchor", () => {
		const next = nextRecurringDate(
			at("2027-01-31", NEW_YORK),
			"MONTHLY",
			null,
			NEW_YORK,
		);
		expect(iso(next)).toBe("2027-02-28T05:00:00.000Z");
	});

	it("weekly keeps midnight across the March spring-forward", () => {
		// Mar 8 00:00 EST (05:00Z) + 7 days is Mar 15 00:00 EDT (04:00Z), 167 hours on.
		const next = nextRecurringDate(
			at("2027-03-08", NEW_YORK),
			"WEEKLY",
			null,
			NEW_YORK,
		);
		expect(iso(next)).toBe("2027-03-15T04:00:00.000Z");
	});

	it("biweekly keeps midnight across the November fall-back", () => {
		// Oct 31 00:00 EDT (04:00Z) + 14 days is Nov 14 00:00 EST (05:00Z), 337 hours on.
		const next = nextRecurringDate(
			at("2027-10-31", NEW_YORK),
			"BIWEEKLY",
			null,
			NEW_YORK,
		);
		expect(iso(next)).toBe("2027-11-14T05:00:00.000Z");
	});

	it("monthly across the spring-forward keeps midnight", () => {
		// Mar 1 00:00 EST (05:00Z) to Apr 1 00:00 EDT (04:00Z).
		const next = nextRecurringDate(
			at("2027-03-01", NEW_YORK),
			"MONTHLY",
			1,
			NEW_YORK,
		);
		expect(iso(next)).toBe("2027-04-01T04:00:00.000Z");
	});

	it("UTC midnight steps as UTC days (income's stored form)", () => {
		const next = nextRecurringDate(
			new Date("2027-01-31T00:00:00.000Z"),
			"MONTHLY",
			31,
			"UTC",
		);
		expect(iso(next)).toBe("2027-02-28T00:00:00.000Z");
	});
});

describe("nextRecurringDate where DST skips local midnight", () => {
	const SANTIAGO = "America/Santiago";
	const HAVANA = "America/Havana";
	const BEIRUT = "Asia/Beirut";

	it("Santiago: weekly onto Sep 5 lands on 01:00 that day, then back on midnight", () => {
		// Sep 5 2027 00:00 -04 does not exist; the clock jumps to 01:00 -03 (04:00Z).
		const gap = nextRecurringDate(
			at("2027-08-29", SANTIAGO),
			"WEEKLY",
			null,
			SANTIAGO,
		);
		expect(iso(gap)).toBe("2027-09-05T04:00:00.000Z");
		expect(dayKey(gap, SANTIAGO)).toBe("2027-09-05");
		const after = nextRecurringDate(gap, "WEEKLY", null, SANTIAGO);
		expect(iso(after)).toBe("2027-09-12T03:00:00.000Z");
	});

	it("Santiago: monthly anchor 5 keeps Sep 5 as the day and Oct 5 at midnight", () => {
		const sep = nextRecurringDate(
			at("2027-08-05", SANTIAGO),
			"MONTHLY",
			5,
			SANTIAGO,
		);
		expect(dayKey(sep, SANTIAGO)).toBe("2027-09-05");
		const oct = nextRecurringDate(sep, "MONTHLY", 5, SANTIAGO);
		expect(iso(oct)).toBe("2027-10-05T03:00:00.000Z");
	});

	it("Havana: biweekly onto Mar 14 lands on 01:00 that day (05:00Z)", () => {
		const gap = nextRecurringDate(
			at("2027-02-28", HAVANA),
			"BIWEEKLY",
			null,
			HAVANA,
		);
		expect(iso(gap)).toBe("2027-03-14T05:00:00.000Z");
		expect(dayKey(gap, HAVANA)).toBe("2027-03-14");
		const after = nextRecurringDate(gap, "BIWEEKLY", null, HAVANA);
		expect(iso(after)).toBe("2027-03-28T04:00:00.000Z");
	});

	it("Beirut: weekly onto Mar 28 lands on 01:00 that day (22:00Z the day before)", () => {
		const gap = nextRecurringDate(
			at("2027-03-21", BEIRUT),
			"WEEKLY",
			null,
			BEIRUT,
		);
		expect(iso(gap)).toBe("2027-03-27T22:00:00.000Z");
		expect(dayKey(gap, BEIRUT)).toBe("2027-03-28");
		const after = nextRecurringDate(gap, "WEEKLY", null, BEIRUT);
		expect(iso(after)).toBe("2027-04-03T21:00:00.000Z");
	});
});

// The due-day stepping moved here from the server (income/due-day.test.ts).
describe("due-day stepping", () => {
	// A process zone that is neither UTC nor the user's, so reading the wrong one shows.
	beforeEach(() => {
		vi.stubEnv("TZ", "America/Los_Angeles");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("nextDueDay", () => {
		it("steps UTC midnight days: Jan 31 monthly is Feb 28, never a local day", () => {
			// Jan 31 00:00Z is Jan 30 16:00 in Los Angeles; a local step gives Feb 28 08:00Z.
			expect(iso(nextDueDay(new Date("2027-01-31T00:00:00Z"), "MONTHLY"))).toBe(
				"2027-02-28T00:00:00.000Z",
			);
		});

		it("anchors on an explicit day and on the UTC day when none is given", () => {
			const jan31 = new Date("2027-01-31T00:00:00Z");
			expect(iso(nextDueDay(jan31, "MONTHLY", 15))).toBe(
				"2027-02-15T00:00:00.000Z",
			);
			expect(
				iso(nextDueDay(new Date("2027-02-28T00:00:00Z"), "MONTHLY", 31)),
			).toBe("2027-03-31T00:00:00.000Z");
			expect(iso(nextDueDay(jan31, "QUARTERLY"))).toBe(
				"2027-04-30T00:00:00.000Z",
			);
		});
	});

	describe("nextDueAfter", () => {
		const income = {
			direction: "IN",
			frequency: "MONTHLY",
			anchorDay: 31,
		} as const;
		const expense = {
			direction: "OUT",
			frequency: "MONTHLY",
			anchorDay: 31,
		} as const;

		it("income steps UTC days whatever the user's zone is", () => {
			// In Buenos Aires Jan 31 00:00Z is Jan 30, whose step would be 03:00Z.
			expect(
				iso(
					nextDueAfter(income, new Date("2027-01-31T00:00:00Z"), BUENOS_AIRES),
				),
			).toBe("2027-02-28T00:00:00.000Z");
		});

		it("an expense steps the user's local days", () => {
			// Jan 31 00:00 in Tokyo is Jan 30 15:00Z; the next is Feb 28 00:00 Tokyo.
			expect(
				iso(nextDueAfter(expense, new Date("2027-01-30T15:00:00Z"), TOKYO)),
			).toBe("2027-02-27T15:00:00.000Z");
		});
	});

	describe("dueAnchorDay", () => {
		const due = (
			direction: "IN" | "OUT",
			anchorDay: number | null,
			at: string,
		) => ({
			direction,
			frequency: "MONTHLY" as const,
			anchorDay,
			nextDueDate: new Date(at),
		});

		it("keeps a stored anchor of either direction", () => {
			expect(dueAnchorDay(due("IN", 15, "2027-01-31T00:00:00Z"), TOKYO)).toBe(
				15,
			);
			expect(dueAnchorDay(due("OUT", 15, "2027-01-31T00:00:00Z"), TOKYO)).toBe(
				15,
			);
		});

		it("income without an anchor reads the UTC day", () => {
			// Jan 31 00:00Z is already Jan 31 09:00 in Tokyo but Jan 30 in Buenos Aires.
			expect(
				dueAnchorDay(due("IN", null, "2027-01-31T00:00:00Z"), BUENOS_AIRES),
			).toBe(31);
		});

		it("an expense without an anchor reads the day in the user's zone", () => {
			// Jan 30 15:00Z is Jan 31 00:00 in Tokyo.
			expect(
				dueAnchorDay(due("OUT", null, "2027-01-30T15:00:00Z"), TOKYO),
			).toBe(31);
		});
	});
});
