import { CURRENCIES } from "@retrospend/domain/currencies";
import { englishCurrencyName, localCurrencyName } from "./currency-names";
import { CURRENCY_NAMES } from "./currency-names.generated";
import { APP_LOCALES } from "./locales";

describe("localCurrencyName", () => {
	const displayNames = Intl.DisplayNames;

	// Hermes: no Intl.DisplayNames at all.
	beforeEach(() => {
		// @ts-expect-error the runtime the app ships on lacks it
		delete Intl.DisplayNames;
	});
	afterEach(() => {
		Intl.DisplayNames = displayNames;
	});

	it("names currencies in the app language without Intl.DisplayNames", () => {
		expect(localCurrencyName("USD", "es")).toBe("dólar estadounidense");
		expect(localCurrencyName("USD", "es-AR")).toBe("dólar estadounidense");
		expect(localCurrencyName("EUR", "de")).toBe("Euro");
		expect(localCurrencyName("ARS", "ru")).toBe("аргентинский песо");
	});

	it("uses the list's name in English and for codes CLDR lacks", () => {
		expect(localCurrencyName("USD", "en")).toBe("US Dollar");
		expect(localCurrencyName("BTC", "fr")).toBe(englishCurrencyName("BTC"));
		expect(localCurrencyName("XYZQ", "fr")).toBe("XYZQ");
	});

	it("has a table for every app language but English", () => {
		const tables = Object.keys(CURRENCY_NAMES).sort();
		expect(tables).toEqual(APP_LOCALES.filter((l) => l !== "en").sort());
	});

	it("names every fiat currency (rerun generate-currency-names.mjs)", () => {
		for (const locale of ["es", "ru", "pt-BR", "fr", "de"]) {
			const missing = Object.keys(CURRENCIES).filter(
				(code) => !CURRENCY_NAMES[locale]?.[code],
			);
			expect({ locale, missing }).toEqual({ locale, missing: [] });
		}
	});
});
