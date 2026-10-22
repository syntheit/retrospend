import { describe, expect, it } from "vitest";
import { paidOnDate } from "./record.mutation";

describe("paidOnDate", () => {
	const lateEvening = new Date("2026-10-22T01:30:00.000Z"); // Oct 21, 22:30 in Buenos Aires

	it("defaults to the user's local day, not the UTC day", () => {
		expect(
			paidOnDate(
				null,
				lateEvening,
				"America/Argentina/Buenos_Aires",
			).toISOString(),
		).toBe("2026-10-21T00:00:00.000Z");
		expect(paidOnDate(null, lateEvening, "UTC").toISOString()).toBe(
			"2026-10-22T00:00:00.000Z",
		);
	});

	it("keeps the date the client sent", () => {
		expect(paidOnDate("2026-10-19", lateEvening, "UTC").toISOString()).toBe(
			"2026-10-19T00:00:00.000Z",
		);
	});

	it("refuses a malformed date", () => {
		expect(() => paidOnDate("21/10/2026", lateEvening, "UTC")).toThrow(
			"Pick a valid date",
		);
	});
});
