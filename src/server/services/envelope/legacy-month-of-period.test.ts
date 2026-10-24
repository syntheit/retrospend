import { describe, expect, it } from "vitest";
import { monthOfPeriod } from "./legacy-migrate.service";

describe("monthOfPeriod", () => {
	// The old server wrote midnight on the 1st in its own zone, so the instant
	// moves with that zone; the month must not.
	it.each([
		["UTC", "2026-10-01T00:00:00Z"],
		["Buenos Aires (UTC-3)", "2026-10-01T03:00:00Z"],
		["Baker Island (UTC-12)", "2026-10-01T12:00:00Z"],
		["Auckland (UTC+13, the day before)", "2026-09-30T11:00:00Z"],
		["Kiritimati (UTC+14, the day before)", "2026-09-30T10:00:00Z"],
	])("%s is October 2026", (_zone, instant) => {
		expect(monthOfPeriod(new Date(instant))).toBe(202610);
	});

	it("crosses the year", () => {
		expect(monthOfPeriod(new Date("2025-12-31T11:00:00Z"))).toBe(202601);
		expect(monthOfPeriod(new Date("2026-12-01T00:00:00Z"))).toBe(202612);
	});
});
