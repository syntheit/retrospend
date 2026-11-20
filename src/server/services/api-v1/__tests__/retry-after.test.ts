import { describe, expect, it } from "vitest";
import { retryAfterSeconds } from "../retry-after";

const NOW = 1_700_000_000_000;

describe("retryAfterSeconds", () => {
	it("says 1 when nothing is left, so a client never retries at once", () => {
		expect(retryAfterSeconds(NOW, NOW)).toBe(1);
	});

	it("rounds a millisecond up to a whole second", () => {
		expect(retryAfterSeconds(NOW + 1, NOW)).toBe(1);
	});

	it("rounds 999 ms up to 1", () => {
		expect(retryAfterSeconds(NOW + 999, NOW)).toBe(1);
	});

	it("says exactly 1 at 1000 ms", () => {
		expect(retryAfterSeconds(NOW + 1000, NOW)).toBe(1);
	});

	it("rounds 1001 ms up to 2", () => {
		expect(retryAfterSeconds(NOW + 1001, NOW)).toBe(2);
	});

	it("never goes below 1 when the window already ended", () => {
		expect(retryAfterSeconds(NOW - 5000, NOW)).toBe(1);
	});

	it("keeps a long wait whole", () => {
		expect(retryAfterSeconds(NOW + 15 * 60_000, NOW)).toBe(900);
	});
});
