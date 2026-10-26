import { describe, expect, it } from "vitest";
import { isUnreachable, retryDelayMs } from "./schedule";

describe("isUnreachable", () => {
	it("is true for errors where nothing answered, false for an answer", () => {
		for (const code of [
			"timeout",
			"connection_refused",
			"connection_error",
			"dns_failed",
			"tls_error",
		])
			expect(isUnreachable(code)).toBe(true);
		for (const code of ["http_503", "blocked_target", "internal_error"])
			expect(isUnreachable(code)).toBe(false);
	});
});

describe("retryDelayMs", () => {
	it("stops after the last attempt", () => {
		expect(retryDelayMs(1)).toBe(30_000);
		expect(retryDelayMs(8)).toBeNull();
	});
});
