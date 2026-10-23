import { describe, expect, it } from "vitest";
import { passwordChecks, passwordReady } from "../security/password-rules";

describe("password rules", () => {
	it("checks length, case and a number", () => {
		expect(passwordChecks("")).toEqual({
			length: false,
			case: false,
			number: false,
		});
		expect(passwordChecks("abcdefgh")).toEqual({
			length: true,
			case: false,
			number: false,
		});
		expect(passwordChecks("Abcdefg1")).toEqual({
			length: true,
			case: true,
			number: true,
		});
	});

	it("is ready only with the current password and a matching new one", () => {
		const ok = { current: "old", next: "Abcdefg1", confirm: "Abcdefg1" };
		expect(passwordReady(ok)).toBe(true);
		expect(passwordReady({ ...ok, current: "" })).toBe(false);
		expect(passwordReady({ ...ok, confirm: "Abcdefg2" })).toBe(false);
		expect(passwordReady({ ...ok, next: "short1A", confirm: "short1A" })).toBe(
			false,
		);
	});
});
