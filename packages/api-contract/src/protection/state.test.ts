import { describe, expect, it } from "vitest";
import { isProtected } from "./state";

describe("isProtected", () => {
	it("is false only for an explicit OFF", () => {
		expect(isProtected("OFF")).toBe(false);
		expect(isProtected("ON")).toBe(true);
		// A state K9 adds later, or a session that never loaded the field.
		expect(isProtected("TURNING_ON")).toBe(true);
		expect(isProtected(undefined)).toBe(true);
		expect(isProtected(null)).toBe(true);
		expect(isProtected("off")).toBe(true);
		expect(isProtected("")).toBe(true);
	});
});
