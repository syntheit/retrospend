import { loadMessages, matchLocale, SUPPORTED_LOCALES } from "./i18n";

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
