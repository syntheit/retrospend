/**
 * Maps 3-letter currency ISO codes to 2-letter country codes
 * for the circle-flags drawings the web and the apps show.
 */
export const CURRENCY_TO_COUNTRY: Record<string, string> = {
	// Common Currencies
	USD: "us",
	EUR: "eu",
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

/** Countries that use the euro, by 2-letter region code. */
const EURO_REGIONS = new Set([
	"AD",
	"AT",
	"BE",
	"CY",
	"DE",
	"EE",
	"ES",
	"FI",
	"FR",
	"GR",
	"HR",
	"IE",
	"IT",
	"LT",
	"LU",
	"LV",
	"MC",
	"ME",
	"MT",
	"NL",
	"PT",
	"SI",
	"SK",
	"SM",
	"VA",
	"XK",
]);

/**
 * The currency of the region in a locale tag ("es-AR" is ARS, "de-DE" is
 * EUR), or null when the tag has no region or no supported currency uses it.
 * Used to suggest a home currency at sign-up.
 */
export function currencyForLocale(
	tag: string,
	supported: ReadonlySet<string>,
): string | null {
	const region = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(tag)?.[1]?.toUpperCase();
	if (!region) return null;
	if (EURO_REGIONS.has(region)) return supported.has("EUR") ? "EUR" : null;
	const lower = region.toLowerCase();
	for (const code of supported)
		if (getCountryCodeFromCurrency(code) === lower) return code;
	return null;
}
