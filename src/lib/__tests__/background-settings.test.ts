import { describe, expect, it } from "vitest";
import {
	backgroundSettingsSchema,
	defaultBackgroundSettings,
} from "../background-settings";

describe("profile background settings", () => {
	it("reads a stored row back unchanged", () => {
		const stored = {
			symbolSets: ["currency", "finance"],
			color: "gold",
			density: "dense",
			animation: "float",
			opacity: "bold",
		};
		expect(backgroundSettingsSchema.parse(stored)).toEqual(stored);
		expect(backgroundSettingsSchema.parse(defaultBackgroundSettings)).toEqual(
			defaultBackgroundSettings,
		);
	});

	it("drops keys it does not know", () => {
		expect(
			backgroundSettingsSchema.parse({ ...defaultBackgroundSettings, version: 1 }),
		).toEqual(defaultBackgroundSettings);
	});

	it("rejects rows the profile page would fall back on", () => {
		// Shared PROFILE row written by page settings: { version: 1 } only
		expect(backgroundSettingsSchema.safeParse({ version: 1 }).success).toBe(false);
		expect(
			backgroundSettingsSchema.safeParse({ ...defaultBackgroundSettings, color: "pink" })
				.success,
		).toBe(false);
	});

	it("keeps the message for an empty symbol set", () => {
		const result = backgroundSettingsSchema.safeParse({
			...defaultBackgroundSettings,
			symbolSets: [],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe("At least one symbol set is required");
	});
});
