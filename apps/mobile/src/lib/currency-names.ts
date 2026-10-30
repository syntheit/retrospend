import { CRYPTO_CURRENCIES, CURRENCIES } from "@retrospend/domain/currencies";
import { getCountryCodeFromCurrency } from "@retrospend/domain/currency-country";
import { currencyName } from "@retrospend/domain/currency-names";
import { COUNTRY_NAMES } from "./country-names.generated";
import { CURRENCY_NAMES } from "./currency-names.generated";

/** The name from the currency list ("US Dollar"), or the code. */
export function englishCurrencyName(code: string): string {
	return (CURRENCIES[code] ?? CRYPTO_CURRENCIES[code])?.name ?? code;
}

/**
 * A currency's name in the app language. Hermes has no Intl.DisplayNames, so
 * the shipped CLDR table comes first (es-AR falls back to es), then the
 * runtime, then the English name.
 */
export function localCurrencyName(code: string, locale: string): string {
	const language = locale.split("-")[0] ?? locale;
	return (
		CURRENCY_NAMES[locale]?.[code] ??
		CURRENCY_NAMES[language]?.[code] ??
		currencyName(code, locale, englishCurrencyName(code))
	);
}

/**
 * The names of the country whose flag a currency carries, in the app
 * language and in English (crypto has no country). The picker's search reads
 * them, so "brasil" and "brazil" both find BRL.
 */
export function countryNamesOf(code: string, locale: string): string[] {
	const country = getCountryCodeFromCurrency(code);
	if (!country) return [];
	const language = locale.split("-")[0] ?? locale;
	const names = [
		COUNTRY_NAMES[locale]?.[country],
		COUNTRY_NAMES[language]?.[country],
		COUNTRY_NAMES.en?.[country],
	].filter((name): name is string => Boolean(name));
	return [...new Set(names)];
}
