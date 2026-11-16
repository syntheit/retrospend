import { describe, expect, it } from "vitest";
import { isSignInSecret, SIGN_IN_SECRET_LENGTH, signInSecret } from "../src";

// The bytes 00 to 1f. Standard base64 of them is
// AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8= ; the sign-in secret is the same
// text with the padding dropped (and "-" and "_" for "+" and "/", which this
// input does not reach). Web, mobile and server tests share this vector.
const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i);
const TEXT = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

// 0xfb 0xff 0xbe encode as "-_--" in base64url ("+/++" in base64): the two
// characters that differ between the alphabets.
const URL_SAFE = Uint8Array.from(
	{ length: 32 },
	(_, i) => [0xfb, 0xff, 0xbe][i % 3] ?? 0,
);

describe("signInSecret", () => {
	it("writes the 32 auth key bytes as 43 unpadded base64url characters", () => {
		expect(signInSecret(BYTES)).toBe(TEXT);
		expect(TEXT).toHaveLength(SIGN_IN_SECRET_LENGTH);
	});

	it("uses the url-safe alphabet", () => {
		const text = signInSecret(URL_SAFE);
		expect(text.startsWith("-_--")).toBe(true);
		expect(text).not.toMatch(/[+/=]/);
	});

	it("refuses any other length", () => {
		expect(() => signInSecret(new Uint8Array(31))).toThrow();
		expect(() => signInSecret(new Uint8Array(33))).toThrow();
	});

	it("recognizes only what it writes", () => {
		expect(isSignInSecret(TEXT)).toBe(true);
		expect(isSignInSecret(signInSecret(URL_SAFE))).toBe(true);
		expect(isSignInSecret(`${TEXT}=`)).toBe(false);
		expect(isSignInSecret(TEXT.slice(1))).toBe(false);
		expect(isSignInSecret(`${TEXT}A`)).toBe(false);
		// The last character carries only 4 bits: a non-zero spare bit is a second
		// text for the same bytes, so it is refused.
		expect(isSignInSecret(`${TEXT.slice(0, -1)}9`)).toBe(false);
		expect(isSignInSecret(TEXT.replace("A", "+"))).toBe(false);
	});
});
