import {
	loadMessages,
	matchLocale,
	resolveLocale,
	SUPPORTED_LOCALES,
} from "./i18n";
import { APP_LOCALES } from "./locales";

describe("matchLocale", () => {
	it.each([
		["es-AR", "es-AR"],
		["es_AR", "es-AR"],
		["es-MX", "es"],
		["pt-BR", "pt-BR"],
		["pt-PT", "en"], // no Portuguese catalog other than pt-BR
		["de-AT", "de"],
		["ja-JP", "en"],
		[undefined, "en"],
	])("%s -> %s", (tag, expected) => {
		expect(matchLocale(tag)).toBe(expected);
	});

	// An iPhone set to Spanish with the region Argentina: the tag can arrive
	// bare, as Latin American Spanish, or with the region appended.
	it.each([
		["es", "AR", "es-AR"],
		["es-419", "AR", "es-AR"],
		["es-419-AR", undefined, "es-AR"],
		["es_AR", "AR", "es-AR"],
		["pt", "BR", "pt-BR"],
		["es", "ES", "es"],
		["es", undefined, "es"],
		["es-MX", "AR", "es"], // a language region of its own wins
		["en-US", "AR", "en"],
		["zh-Hans-CN", "AR", "en"],
	])("%s with region %s -> %s", (tag, region, expected) => {
		expect(matchLocale(tag, region)).toBe(expected);
	});
});

describe("resolveLocale", () => {
	it("takes the first preferred language the app has a catalog for", () => {
		expect(
			resolveLocale([
				{ languageTag: "ja-JP" },
				{ languageTag: "es-AR" },
				{ languageTag: "en-US" },
			]),
		).toBe("es-AR");
	});

	it("prefers language-region over the bare language", () => {
		expect(resolveLocale([{ languageTag: "es-AR", regionCode: "ES" }])).toBe(
			"es-AR",
		);
		expect(resolveLocale([{ languageTag: "pt-BR" }])).toBe("pt-BR");
	});

	it("falls back to English", () => {
		expect(resolveLocale([])).toBe("en");
		expect(resolveLocale(null)).toBe("en");
		expect(resolveLocale([{ languageTag: "ja-JP" }])).toBe("en");
	});
});

describe("app locales", () => {
	it("lists the same languages as the catalogs the app loads", () => {
		expect([...SUPPORTED_LOCALES].sort()).toEqual([...APP_LOCALES].sort());
	});
});

describe("loadMessages", () => {
	it("loads the shared catalog and the mobile namespace for every locale", () => {
		for (const locale of SUPPORTED_LOCALES) {
			const messages = loadMessages(locale);
			expect(typeof messages.mobile.tabs.home).toBe("string");
			expect(typeof messages.mobile.connect.title).toBe("string");
			expect(typeof messages.mobile.common.cancel).toBe("string");
		}
	});

	it("translates the tabs (es-AR is not an English copy)", () => {
		expect(loadMessages("es-AR").mobile.tabs.home).toBe("Inicio");
		expect(loadMessages("en").mobile.tabs.home).toBe("Home");
	});
});
