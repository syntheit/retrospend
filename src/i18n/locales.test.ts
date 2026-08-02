import { describe, expect, it } from "vitest";
import {
	matchAcceptLanguage,
	matchSupportedLocale,
} from "./locales";

describe("matchSupportedLocale", () => {
	it("matches supported locale codes", () => {
		expect(matchSupportedLocale("en")).toBe("en");
		expect(matchSupportedLocale("es")).toBe("es");
		expect(matchSupportedLocale("es-AR")).toBe("es-AR");
		expect(matchSupportedLocale("ru")).toBe("ru");
		expect(matchSupportedLocale("pt-BR")).toBe("pt-BR");
		expect(matchSupportedLocale("fr")).toBe("fr");
	});

	it("matches regional and underscore variants by language", () => {
		expect(matchSupportedLocale("es-MX")).toBe("es");
		expect(matchSupportedLocale("es_AR")).toBe("es-AR");
		expect(matchSupportedLocale("ru_RU")).toBe("ru");
		expect(matchSupportedLocale("pt_BR")).toBe("pt-BR");
		expect(matchSupportedLocale("pt-PT")).toBe("pt-BR");
		expect(matchSupportedLocale("fr-CA")).toBe("fr");
	});

	it("rejects unsupported and empty locales", () => {
		expect(matchSupportedLocale("de")).toBeUndefined();
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

	it("prefers exact Argentine Spanish over generic Spanish", () => {
		expect(matchAcceptLanguage("es-AR,es;q=0.9,en;q=0.8")).toBe("es-AR");
		expect(matchAcceptLanguage("es-MX,es-AR;q=0.9")).toBe("es");
	});

	it("matches Brazilian Portuguese and generic Portuguese preferences", () => {
		expect(matchAcceptLanguage("pt-BR")).toBe("pt-BR");
		expect(matchAcceptLanguage("pt")).toBe("pt-BR");
	});

	it("matches French and regional French preferences", () => {
		expect(matchAcceptLanguage("fr-FR")).toBe("fr");
		expect(matchAcceptLanguage("fr-CA, en;q=0.8")).toBe("fr");
	});

	it("ignores locales with zero quality", () => {
		expect(matchAcceptLanguage("ru;q=0, es;q=0.8")).toBe("es");
	});

	it("falls back to English", () => {
		expect(matchAcceptLanguage("de-DE,it-IT")).toBe("en");
		expect(matchAcceptLanguage(null)).toBe("en");
	});
});
