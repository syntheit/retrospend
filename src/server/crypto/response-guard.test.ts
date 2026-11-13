import { describe, expect, it } from "vitest";
import { assertNoSealedText, hasContactHash } from "./response-guard";

const HASH = `${"ab".repeat(8)}:${"cd".repeat(32)}`;

describe("hasContactHash", () => {
	it("finds an emailHash field at any depth, in a map and in a set", () => {
		expect(hasContactHash({ id: "x", emailHash: HASH })).toBe(true);
		expect(hasContactHash({ rows: [{ id: "x", emailHash: HASH }] })).toBe(true);
		expect(hasContactHash(new Map([["k", { v: [{ emailHash: HASH }] }]]))).toBe(
			true,
		);
		expect(hasContactHash(new Set([{ emailHash: HASH }]))).toBe(true);
	});

	it("passes a null hash, other fields and a category's name index of the same shape", () => {
		expect(hasContactHash({ emailHash: null, when: new Date() })).toBe(false);
		expect(hasContactHash({ emailHash: "not a hash" })).toBe(false);
		expect(hasContactHash({ nameIndex: HASH })).toBe(false);
		expect(hasContactHash(HASH)).toBe(false);
		expect(hasContactHash("bob@example.com")).toBe(false);
	});
});

describe("assertNoSealedText", () => {
	it("refuses a contact hash in a test-mode response", () => {
		expect(() => assertNoSealedText({ emailHash: HASH }, "v1")).toThrow(
			/contact hash reached a v1 response/,
		);
		expect(() => assertNoSealedText({ emailHash: null }, "v1")).not.toThrow();
		expect(() => assertNoSealedText({ nameIndex: HASH }, "v1")).not.toThrow();
	});
});
