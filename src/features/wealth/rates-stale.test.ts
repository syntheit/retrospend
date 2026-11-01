import { describe, expect, it } from "vitest";
import { ratesAreStale } from "./rates-stale";

describe("ratesAreStale", () => {
	it("is quiet for rates from today or yesterday, so a UTC day off never shows", () => {
		expect(ratesAreStale("2026-11-01", "2026-11-01")).toBe(false);
		expect(ratesAreStale("2026-11-01", "2026-11-02")).toBe(false);
	});

	it("shows once the rates are more than a day old", () => {
		expect(ratesAreStale("2026-10-30", "2026-11-01")).toBe(true);
		expect(ratesAreStale("2026-09-01", "2026-11-01")).toBe(true);
	});

	it("is quiet with no rates date", () => {
		expect(ratesAreStale(null, "2026-11-01")).toBe(false);
	});
});
