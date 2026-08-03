import { de } from "date-fns/locale/de";
import { enUS } from "date-fns/locale/en-US";
import { describe, expect, it } from "vitest";
import { getDateFnsLocale } from "./date-locale";

describe("getDateFnsLocale", () => {
	it("maps German to the date-fns German locale", () => {
		expect(getDateFnsLocale("de")).toBe(de);
	});

	it("falls back to US English for an unmapped locale", () => {
		expect(getDateFnsLocale("uk")).toBe(enUS);
	});
});
