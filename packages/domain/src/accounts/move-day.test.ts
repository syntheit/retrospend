import { describe, expect, it } from "vitest";
import { moveDay } from "./move-day";
import { AccountRefusal, MOVE_IN_FUTURE, PICK_VALID_DATE } from "./refusals";

// 2026-03-10T16:00Z is Mar 11, 01:00 in Tokyo and Mar 10, 13:00 in Buenos Aires.
const NOW = new Date("2026-03-10T16:00:00Z");
const TOKYO = "Asia/Tokyo";
const BA = "America/Argentina/Buenos_Aires";

describe("moveDay", () => {
	it("is the person's today in their zone when no day is given", () => {
		expect(moveDay(null, NOW, TOKYO).toISOString()).toBe(
			"2026-03-11T00:00:00.000Z",
		);
		expect(moveDay(undefined, NOW, BA).toISOString()).toBe(
			"2026-03-10T00:00:00.000Z",
		);
	});

	it("is the day given, as a UTC midnight, today or earlier", () => {
		expect(moveDay("2026-03-11", NOW, TOKYO).toISOString()).toBe(
			"2026-03-11T00:00:00.000Z",
		);
		expect(moveDay("2026-01-02", NOW, TOKYO).toISOString()).toBe(
			"2026-01-02T00:00:00.000Z",
		);
	});

	it("is never a day that has not started in the person's zone", () => {
		// Mar 11 has started in Tokyo but not in Buenos Aires.
		expect(() => moveDay("2026-03-11", NOW, BA)).toThrow(MOVE_IN_FUTURE);
		const error = (() => {
			try {
				moveDay("2026-03-11", NOW, BA);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(AccountRefusal);
		expect((error as AccountRefusal).kind).toBe("badRequest");
	});

	it("refuses what is not a day", () => {
		for (const bad of ["11/03/2026", "2026-3-1", "2026-13-45", "", "tomorrow"])
			expect(() => moveDay(bad, NOW, BA), bad).toThrow(PICK_VALID_DATE);
	});
});
