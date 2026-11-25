/**
 * The paid-on day, refused or turned into an instant. Base case: a monthly
 * template due 2026-12-01T03:00Z (the start of Dec 1 in Buenos Aires), so its
 * previous due day is Nov 1. "now" is injected.
 */
import { describe, expect, it } from "vitest";
import { paidOnInstant } from "./paid-on";
import { RecurringInputRefusal } from "./refusals";
import { at, BA, ba, TOKYO } from "./test-kit";

const schedule = {
	nextDueDate: ba("2026-12-01"),
	frequency: "MONTHLY",
	anchorDay: 1,
} as const;
const NOW = at("2026-12-01T12:00:00.000Z");

describe("paidOnInstant", () => {
	it("an expense's day is the start of that day in the zone", () => {
		expect(paidOnInstant("2026-11-29", "OUT", BA, schedule, NOW)).toEqual(
			ba("2026-11-29"),
		);
	});

	it("income keeps its day as UTC midnight", () => {
		expect(paidOnInstant("2026-11-29", "IN", BA, schedule, NOW)).toEqual(
			at("2026-11-29T00:00:00.000Z"),
		);
	});

	it("the previous due day itself is allowed; the day before it is not", () => {
		expect(paidOnInstant("2026-11-01", "OUT", BA, schedule, NOW)).toEqual(
			ba("2026-11-01"),
		);
		expect(() =>
			paidOnInstant("2026-10-31", "OUT", BA, schedule, NOW),
		).toThrowError(
			expect.objectContaining({
				constructor: RecurringInputRefusal,
				kind: "date_before_previous_due",
				message: "The date is before the previous due date",
			}),
		);
	});

	it("a day still to come is refused, read in the zone and at the injected now", () => {
		expect(() =>
			paidOnInstant("2026-12-02", "OUT", BA, schedule, NOW),
		).toThrowError(
			expect.objectContaining({
				kind: "date_in_future",
				message: "The date cannot be in the future",
			}),
		);
		// 2026-12-01T16:00Z is Dec 2, 01:00 in Tokyo: Dec 2 is today there, and
		// starts at 2026-12-01T15:00Z.
		expect(
			paidOnInstant(
				"2026-12-02",
				"OUT",
				TOKYO,
				schedule,
				at("2026-12-01T16:00:00.000Z"),
			),
		).toEqual(at("2026-12-01T15:00:00.000Z"));
	});
});
