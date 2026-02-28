/**
 * Maps 3-letter currency ISO codes to 2-letter country codes
 * for use with the circle-flags library.
 */
export const CURRENCY_TO_COUNTRY: Record<string, string> = {
	// Common Currencies
	USD: "us",
	EUR: "european_union",
	GBP: "gb",
	JPY: "jp",
	CHF: "ch",
	CAD: "ca",
	AUD: "au",
	CNY: "cn",
	HKD: "hk",
	NZD: "nz",
	SEK: "se",
	NOK: "no",
	DKK: "dk",
	SGD: "sg",
	INR: "in",
	RUB: "ru",
	ZAR: "za",
	KRW: "kr",
	MXN: "mx",
	IDR: "id",
	TRY: "tr",
	SAR: "sa",
	AED: "ae",
	ILS: "il",
	THB: "th",
	VND: "vn",
	MYR: "my",
	PHP: "ph",

	// Latin America
	ARS: "ar",
	BRL: "br",
	CLP: "cl",
	COP: "co",
	PEN: "pe",
	UYU: "uy",
	PYG: "py",
	BOB: "bo",
	VES: "ve",
	CRC: "cr",
	DOP: "do",
	GTQ: "gt",
	HNL: "hn",
	NIO: "ni",
	PAB: "pa",
	CUP: "cu",

	// Other
	PLN: "pl",
	CZK: "cz",
	HUF: "hu",
	RON: "ro",
	BGN: "bg",
	UAH: "ua",
	EGP: "eg",
	NGN: "ng",
	KES: "ke",
	GHS: "gh",
	MAD: "ma",
	TND: "tn",
	PKR: "pk",
	BDT: "bd",
	LKR: "lk",
};

/**
 * Gets the country code for a given currency code.
 * Falls back to the first 2 letters of the currency code if no mapping exists,
 * which works for many standard currencies (e.g., MXN -> mx).
 */
export function getCountryCodeFromCurrency(
	currencyCode: string,
): string | null {
	const upperCode = currencyCode.toUpperCase();

	// Check explicit mapping
	if (CURRENCY_TO_COUNTRY[upperCode]) {
		return CURRENCY_TO_COUNTRY[upperCode];
	}

	// For standard ISO currencies, the first two letters often represent the country
	// We avoid this for "X" currencies (crypto, commodities, specials)
	if (!upperCode.startsWith("X") && upperCode.length >= 2) {
		return upperCode.slice(0, 2).toLowerCase();
	}

	return null;
}
