import { afterEach, describe, expect, it } from "vitest";
import { SEALING_RELEASED } from "./release";
import {
	sealing,
	sealingWanted,
	setSealingForTests,
	wireSealingSetting,
} from "./sealing";

afterEach(() => {
	wireSealingSetting(() => false);
	setSealingForTests();
});

describe("sealing()", () => {
	it("follows DATA_KEYS_WRITE outside production", () => {
		expect(sealingWanted(false, "test")).toBe(false);
		expect(sealingWanted(true, "test")).toBe(true);
		expect(sealingWanted(true, "development")).toBe(true);
	});

	it("never seals in production while sealing is not released", () => {
		expect(sealingWanted(true, "production", false)).toBe(false);
		expect(sealingWanted(true, "development", false)).toBe(true);
	});

	it("seals in a released production build only with the flag on and the start check passed", () => {
		expect(SEALING_RELEASED).toBe(true);
		expect(sealingWanted(undefined, "production", true, true)).toBe(false);
		expect(sealingWanted(false, "production", true, true)).toBe(false);
		expect(sealingWanted("true", "production", true, true)).toBe(false);
		expect(sealingWanted(true, "production", true, true)).toBe(true);
	});

	it("never seals in production before the start check passed in this process (a script)", () => {
		expect(sealingWanted(true, "production", true, false)).toBe(false);
		// Outside production the flag alone decides, as before.
		expect(sealingWanted(true, "test", true, false)).toBe(true);
	});

	it("is not started until the start check marks it", () => {
		expect(sealingWanted(true, "production")).toBe(false);
	});

	it("takes a skipped validation's raw string as off", () => {
		expect(sealingWanted("true", "test")).toBe(false);
		expect(sealingWanted("false", "test")).toBe(false);
	});

	it("answers the wired setting, and goes back to it after a test override", () => {
		expect(sealing()).toBe(false);
		wireSealingSetting(() => true);
		expect(sealing()).toBe(true);
		setSealingForTests(() => false);
		expect(sealing()).toBe(false);
		setSealingForTests();
		expect(sealing()).toBe(true);
	});
});
