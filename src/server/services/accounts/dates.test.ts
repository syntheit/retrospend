import { snapshotDay } from "@retrospend/domain/accounts/snapshot-plan";
import { describe, expect, it } from "vitest";
import { moveDay } from "./dates";

describe("moveDay with no day given", () => {
	// Create and the checkpoint snapshot by snapshotDay's zone rule and the
	// revert's same-day check compares against moveDay: they must be one day.
	const instants = [
		["Asia/Tokyo", "2026-03-10T16:00:00.000Z", "2026-03-11"],
		[
			"America/Argentina/Buenos_Aires",
			"2026-03-10T02:00:00.000Z",
			"2026-03-09",
		],
		[
			"America/Argentina/Buenos_Aires",
			"2026-12-01T01:30:00.000Z",
			"2026-11-30",
		],
		["UTC", "2026-03-10T23:59:59.999Z", "2026-03-10"],
	] as const;

	it.each(instants)(
		"%s at %s is %s, as the snapshot's zone rule dates it",
		(timeZone, iso, day) => {
			const now = new Date(iso);
			expect(moveDay(null, now, timeZone)).toEqual(
				new Date(`${day}T00:00:00.000Z`),
			);
			expect(moveDay(undefined, now, timeZone)).toEqual(
				snapshotDay({ rule: "zone", now, timeZone }),
			);
		},
	);

	it("a day given is still checked: not in the future, valid", () => {
		const now = new Date("2026-03-10T16:00:00.000Z");
		expect(() => moveDay("2026-03-12", now, "Asia/Tokyo")).toThrow();
		expect(() => moveDay("nope", now, "Asia/Tokyo")).toThrow();
		expect(moveDay("2026-03-11", now, "Asia/Tokyo")).toEqual(
			new Date("2026-03-11T00:00:00.000Z"),
		);
	});
});
