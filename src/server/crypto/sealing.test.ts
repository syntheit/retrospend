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

	it("never seals in production until sealing is released", () => {
		expect(SEALING_RELEASED).toBe(false);
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
