import { randomBytes } from "node:crypto";
import { PASSWORD_PATTERN, passwordMeetsRules } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { generatePassword } from "./generate-password";

// base64url of these bytes, worked out by hand: 12 zero bytes are sixteen "A"
// (no lowercase, no number); 0xff bytes are sixteen "_" (no letter at all);
// the bytes of the sixteen letters "AbCdEfGhIjKlMnOp" have both cases, no number.
const NO_LOWERCASE = Buffer.alloc(12, 0);
const NO_LETTERS = Buffer.alloc(12, 0xff);
const NO_NUMBER = Buffer.from("AbCdEfGhIjKlMnOp", "base64url");
// A real draw that meets the rules, found once and replayed.
const meeting = (() => {
	for (;;) {
		const bytes = randomBytes(12);
		if (passwordMeetsRules(bytes.toString("base64url"))) return bytes;
	}
})();

describe("generatePassword", () => {
	it("gives a password that meets the rules on every one of 5000 draws", () => {
		for (let i = 0; i < 5000; i++) {
			const password = generatePassword();
			expect(password).toHaveLength(16);
			expect(passwordMeetsRules(password)).toBe(true);
			expect(PASSWORD_PATTERN.test(password)).toBe(true);
		}
	});

	it("draws again when a draw misses a case or a number", () => {
		const draws = [NO_LOWERCASE, NO_LETTERS, NO_NUMBER, meeting];
		let used = 0;
		const password = generatePassword(() => draws[used++] ?? Buffer.alloc(12));
		expect(used).toBe(4);
		expect(password).toBe(meeting.toString("base64url"));
		expect(passwordMeetsRules(NO_LOWERCASE.toString("base64url"))).toBe(false);
		expect(passwordMeetsRules(NO_LETTERS.toString("base64url"))).toBe(false);
		expect(passwordMeetsRules(NO_NUMBER.toString("base64url"))).toBe(false);
	});

	it("stops instead of looping forever on a broken source", () => {
		let draws = 0;
		expect(() =>
			generatePassword(() => {
				draws++;
				return NO_LOWERCASE;
			}),
		).toThrow("No generated password met the password rules");
		expect(draws).toBe(50);
	});
});
