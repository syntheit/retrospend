import { describe, expect, it } from "vitest";
import {
	matchAcceptLanguage,
	matchSupportedLocale,
} from "./locales";

describe("matchSupportedLocale", () => {
	it("matches supported locale codes", () => {
		expect(matchSupportedLocale("en")).toBe("en");
		expect(matchSupportedLocale("es")).toBe("es");
		expect(matchSupportedLocale("ru")).toBe("ru");
	});

	it("matches regional and underscore variants by language", () => {
		expect(matchSupportedLocale("es-MX")).toBe("es");
		expect(matchSupportedLocale("ru_RU")).toBe("ru");
	});

	it("rejects unsupported and empty locales", () => {
		expect(matchSupportedLocale("fr")).toBeUndefined();
		expect(matchSupportedLocale("")).toBeUndefined();
		expect(matchSupportedLocale(undefined)).toBeUndefined();
	});
});

describe("matchAcceptLanguage", () => {
	it("selects the supported locale with the highest quality", () => {
		expect(matchAcceptLanguage("ru;q=0.5, es-MX;q=0.9, en;q=0.7")).toBe(
			"es",
		);
	});

	it("preserves header order when qualities are equal", () => {
		expect(matchAcceptLanguage("ru-RU,es-ES")).toBe("ru");
	});

	it("ignores locales with zero quality", () => {
		expect(matchAcceptLanguage("ru;q=0, es;q=0.8")).toBe("es");
	});

	it("falls back to English", () => {
		expect(matchAcceptLanguage("fr-FR,de-DE")).toBe("en");
		expect(matchAcceptLanguage(null)).toBe("en");
	});
});
