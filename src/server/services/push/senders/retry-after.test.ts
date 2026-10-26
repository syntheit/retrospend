import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "./retry-after";

const NOW = new Date("2026-10-26T15:00:00Z");

describe("Retry-After", () => {
	it("reads a number of seconds", () => {
		expect(parseRetryAfter("120", NOW)).toBe(120_000);
		expect(parseRetryAfter(" 7 ", NOW)).toBe(7000);
	});

	it("reads an HTTP date as the wait from now", () => {
		expect(parseRetryAfter("Mon, 26 Oct 2026 15:05:00 GMT", NOW)).toBe(300_000);
	});

	it("has no hint for a date in the past, zero, or anything else", () => {
		expect(parseRetryAfter("Mon, 26 Oct 2026 14:00:00 GMT", NOW)).toBe(
			undefined,
		);
		expect(parseRetryAfter("0", NOW)).toBe(undefined);
		expect(parseRetryAfter("-5", NOW)).toBe(undefined);
		expect(parseRetryAfter("1.5", NOW)).toBe(undefined);
		expect(parseRetryAfter("soon", NOW)).toBe(undefined);
		expect(parseRetryAfter("", NOW)).toBe(undefined);
		expect(parseRetryAfter(undefined, NOW)).toBe(undefined);
	});

	it("caps a huge number so it cannot overflow a date", () => {
		expect(parseRetryAfter("99999999999999999999", NOW)).toBe(
			7 * 24 * 3600_000,
		);
	});
});
