import { describe, expect, it } from "vitest";
import {
	PASSWORD_CHECKS,
	PASSWORD_PATTERN,
	passwordChecks,
	passwordFirstIssue,
	passwordMeetsRules,
	passwordReady,
} from "./password-rules";
import { changePasswordSchema, newPasswordSchema } from "./security";

const ALL_MET = { length: true, case: true, number: true };

describe("passwordChecks", () => {
	it("holds the length at 8 and at 255, and nowhere else", () => {
		expect(passwordChecks("Abcdef1").length).toBe(false);
		expect(passwordChecks("Abcdefg1").length).toBe(true);
		expect(passwordChecks(`Aa1${"x".repeat(252)}`).length).toBe(true);
		expect(passwordChecks(`Aa1${"x".repeat(253)}`).length).toBe(false);
	});

	it("needs a lowercase and an uppercase letter, not either alone", () => {
		expect(passwordChecks("abcdefg1").case).toBe(false);
		expect(passwordChecks("ABCDEFG1").case).toBe(false);
		expect(passwordChecks("Abcdefg1").case).toBe(true);
	});

	it("reads only ASCII letters, so a letter with an accent is not a case", () => {
		expect(passwordChecks("éééééééé1").case).toBe(false);
		expect(passwordChecks("ÉÉÉÉÉÉÉé1").case).toBe(false);
	});

	it("needs a number", () => {
		expect(passwordChecks("Abcdefgh").number).toBe(false);
		expect(passwordChecks("Abcdefg1").number).toBe(true);
	});

	it("reports each rule on its own", () => {
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
		expect(passwordChecks("Abcdefg1")).toEqual(ALL_MET);
	});

	it("names the three checks the screens list", () => {
		expect(PASSWORD_CHECKS).toEqual(Object.keys(passwordChecks("")));
	});
});

// The server schema, the pattern in the OpenAPI document and the client rule
// are the same rule: they may never disagree on a password. Each vector's
// answer is derived by hand from the rule (8 to 255 characters, and one line
// holding a lowercase letter, an uppercase letter and a number).
const VECTORS: [string, boolean, "min" | "max" | "complexity" | null][] = [
	["", false, "min"],
	["Abcdef1", false, "min"],
	["Abcdefg1", true, null],
	["abcdefg1", false, "complexity"],
	["ABCDEFG1", false, "complexity"],
	["Abcdefgh", false, "complexity"],
	// The pattern reads one line: the number or the uppercase letter on the
	// next line does not count, and neither client nor server accepts it.
	["Abcdefg\n1", false, "complexity"],
	["abcdefg\nA1", false, "complexity"],
	["Abcdefg1\nxyz", true, null],
	["éééééééé1É", false, "complexity"],
	["Battery staple 2", true, null],
	[`Aa1${"x".repeat(252)}`, true, null],
	[`Aa1${"x".repeat(253)}`, false, "max"],
];

describe("one rule everywhere", () => {
	for (const [value, meets, issue] of VECTORS) {
		it(`agrees on ${JSON.stringify(value.slice(0, 24))} (${value.length})`, () => {
			expect(passwordMeetsRules(value)).toBe(meets);
			expect(passwordFirstIssue(value)).toBe(issue);
			expect(newPasswordSchema.safeParse(value).success).toBe(meets);
			expect(
				changePasswordSchema.safeParse({
					currentPassword: "old",
					newPassword: value,
				}).success,
			).toBe(meets);
		});
	}

	it("keeps the pattern the OpenAPI document publishes", () => {
		expect(PASSWORD_PATTERN.source).toBe("(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)");
		expect(PASSWORD_PATTERN.flags).toBe("");
	});
});

describe("passwordReady", () => {
	const ok = { current: "old", next: "Abcdefg1", confirm: "Abcdefg1" };

	it("is ready only with the current password, every rule and a match", () => {
		expect(passwordReady(ok)).toBe(true);
		expect(passwordReady({ ...ok, current: "" })).toBe(false);
		expect(passwordReady({ ...ok, confirm: "Abcdefg2" })).toBe(false);
		expect(passwordReady({ ...ok, next: "short1A", confirm: "short1A" })).toBe(
			false,
		);
		expect(
			passwordReady({ ...ok, next: "abcdefg1", confirm: "abcdefg1" }),
		).toBe(false);
	});
});
