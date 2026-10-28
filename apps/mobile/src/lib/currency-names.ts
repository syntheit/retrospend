import { CRYPTO_CURRENCIES, CURRENCIES } from "@retrospend/domain/currencies";
import { currencyName } from "@retrospend/domain/currency-names";
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
