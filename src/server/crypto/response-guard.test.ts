import { describe, expect, it } from "vitest";
import { assertNoSealedText, hasContactHash } from "./response-guard";

const HASH = `${"ab".repeat(8)}:${"cd".repeat(32)}`;

describe("hasContactHash", () => {
	it("finds a hash at any depth, in a map and in a set", () => {
		expect(hasContactHash(HASH)).toBe(true);
		expect(hasContactHash({ rows: [{ id: "x", emailHash: HASH }] })).toBe(true);
		expect(hasContactHash(new Map([["k", { v: [HASH] }]]))).toBe(true);
		expect(hasContactHash(new Set([HASH]))).toBe(true);
	});

	it("passes text that only looks a little like one", () => {
		expect(hasContactHash("bob@example.com")).toBe(false);
		expect(hasContactHash(`${"ab".repeat(8)}:${"cd".repeat(31)}`)).toBe(false);
		expect(hasContactHash(`${"AB".repeat(8)}:${"CD".repeat(32)}`)).toBe(false);
		expect(hasContactHash(` ${HASH}`)).toBe(false);
		expect(hasContactHash({ emailHash: null, when: new Date() })).toBe(false);
	});
});

describe("assertNoSealedText", () => {
	it("refuses a contact hash in a test-mode response", () => {
		expect(() => assertNoSealedText({ emailHash: HASH }, "v1")).toThrow(
			/contact hash reached a v1 response/,
		);
		expect(() => assertNoSealedText({ emailHash: null }, "v1")).not.toThrow();
	});
});
