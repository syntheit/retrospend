import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FALLBACK_TIME_ZONE,
	resolveTimeZone,
	supportedTimeZone,
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
