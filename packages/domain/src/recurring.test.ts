import { describe, expect, it } from "vitest";
import { nextRecurringDate } from "./recurring";
import { dayKey, parseDateOnlyIn } from "./time-zone";

const NEW_YORK = "America/New_York";
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const AUCKLAND = "Pacific/Auckland";

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
