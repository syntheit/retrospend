import { describe, expect, it } from "vitest";
import { DEFAULT_PREF, flip, samePref } from "../notifications/prefs";

describe("notification switches", () => {
	const on = { inApp: true, email: true, digestMode: true };

	it("flips one channel", () => {
		expect(flip(DEFAULT_PREF, "email", true)).toEqual({
			inApp: true,
			email: true,
			digestMode: false,
		});
		expect(flip(on, "inApp", false)).toEqual({ ...on, inApp: false });
	});

	it("turns the digest off with Email", () => {
		expect(flip(on, "email", false)).toEqual({
			inApp: true,
			email: false,
			digestMode: false,
		});
	});

	it("does not turn the digest on without Email", () => {
		expect(flip(DEFAULT_PREF, "digestMode", true)).toEqual(DEFAULT_PREF);
	});

	it("compares preferences by value", () => {
		expect(samePref(on, { ...on })).toBe(true);
		expect(samePref(on, DEFAULT_PREF)).toBe(false);
	});
});
