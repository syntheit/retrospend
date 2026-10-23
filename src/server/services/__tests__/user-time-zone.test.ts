import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FALLBACK_TIME_ZONE,
	resolveTimeZone,
	supportedTimeZone,
	todayAsDueDate,
} from "../user-time-zone";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("supportedTimeZone", () => {
	it("returns the canonical spelling of a listed zone or alias", () => {
		expect(supportedTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
		expect(supportedTimeZone("asia/tokyo")).toBe("Asia/Tokyo");
		expect(supportedTimeZone("America/Argentina/Buenos_Aires")).toBe(
			"America/Buenos_Aires",
		);
		expect(supportedTimeZone("UTC")).toBe("UTC");
	});

	it("refuses names the runtime does not list", () => {
		for (const bad of ["Mars/Olympus_Mons", "Etc/GMT+3", "", null, 42]) {
			expect(supportedTimeZone(bad)).toBeUndefined();
		}
	});
});

describe("resolveTimeZone", () => {
	it("prefers the request's zone, then the stored one, then the default", () => {
		vi.stubEnv("DEFAULT_TIME_ZONE", "Europe/Madrid");
		expect(resolveTimeZone("Asia/Tokyo", "America/Lima")).toBe("America/Lima");
		expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
		expect(resolveTimeZone(null)).toBe("Europe/Madrid");
		expect(resolveTimeZone("Mars/Olympus_Mons")).toBe("Europe/Madrid");
	});

	it("falls back to Buenos Aires without DEFAULT_TIME_ZONE", () => {
		vi.stubEnv("DEFAULT_TIME_ZONE", "");
		expect(resolveTimeZone(undefined)).toBe(FALLBACK_TIME_ZONE);
	});
});

describe("todayAsDueDate", () => {
	it("is the UTC midnight of today where the user is", () => {
		// Nov 1, 05:00 in Tokyo; Oct 31, 17:00 in Buenos Aires.
		const now = new Date("2026-10-31T20:00:00Z");
		expect(todayAsDueDate("Asia/Tokyo", now).toISOString()).toBe(
			"2026-11-01T00:00:00.000Z",
		);
		expect(
			todayAsDueDate("America/Argentina/Buenos_Aires", now).toISOString(),
		).toBe("2026-10-31T00:00:00.000Z");
	});
});
