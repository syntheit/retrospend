import { CRYPTO_CURRENCIES, CURRENCIES } from "./currencies";
import { partsOf } from "./intl-parts";

/** Stablecoin tickers that should use 2 decimals instead of 8. */
const STABLECOINS = ["USDC", "USDT", "DAI", "BUSD"] as const;

/**
 * Returns the appropriate decimal precision for a currency.
 * Crypto: 8 (stablecoins: 2). Smart no-decimal fiat (JPY, KRW): 0. Default fiat: 2.
 */
export function getDecimalDigits(currency: string, smart = true): number {
	const code = currency.toUpperCase();
	if (isCrypto(code)) {
		return (STABLECOINS as readonly string[]).includes(code) ? 2 : 8;
	}
	if (smart && SMART_NO_DECIMAL_CURRENCIES.includes(code)) return 0;
	return CURRENCIES[code as keyof typeof CURRENCIES]?.decimal_digits ?? 2;
}

/**
 * Formats a number with thousands separators and fixed decimals.
 * Symbol-free: use for input formatting and display-only numbers.
 */
export function formatNumber(value: number, decimals = 2): string {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(value);
}

/**
 * Formats a number as a percentage string, e.g. "12.3%".
 */
export function formatPercent(value: number, decimals = 1): string {
	return `${formatNumber(value, decimals)}%`;
}

/**
 * Strips commas from a formatted number string and parses to float.
 * Returns NaN for empty/invalid strings (caller should check with isNaN).
 */
export function parseFormattedNumber(formatted: string): number {
	return parseFloat(formatted.replace(/,/g, ""));
}

export function getCurrencySymbol(
	currency: string,
	useNativeForDefault = false,
): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	if (useNativeForDefault) {
		return currencyData?.symbol_native || currency.toUpperCase();
	}
	return currencyData?.symbol || currency.toUpperCase();
}

/**
 * Gets the currency symbol based on user preference (native or standard).
 */
export function getCurrencySymbolWithPreference(
	currency: string,
	currencySymbolStyle: "native" | "standard" = "standard",
): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	return currencySymbolStyle === "native"
		? currencyData?.symbol_native ||
				currencyData?.symbol ||
				currency.toUpperCase()
		: currencyData?.symbol || currency.toUpperCase();
}

/**
 * A compact money label for chart axes: "AR$1.2M", "-US$250K". `symbol` is
 * the currency symbol in the user's chosen style (see useCurrencyFormatter),
 * so an axis names the same currency as every other amount on the page.
 */
export function formatCompactAmount(
	amount: number,
	symbol: string,
	locale = "en-US",
): string {
	const digits = new Intl.NumberFormat(locale, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(Math.abs(amount));
	const sign = amount < 0 && /[1-9]/.test(digits) ? "-" : "";
	return `${sign}${symbol}${digits}`;
}

export function getCurrencyName(currency: string): string {
	const code = currency.toUpperCase();
	const fiatData = CURRENCIES[code as keyof typeof CURRENCIES];
	if (fiatData) return fiatData.name;
	const cryptoData = CRYPTO_CURRENCIES[code as keyof typeof CRYPTO_CURRENCIES];
	if (cryptoData) return cryptoData.name;
	return code;
}

/**
 * Currencies where decimals are typically redundant due to high denomination.
 */
export const SMART_NO_DECIMAL_CURRENCIES = [
	"ARS", // Argentine Peso
	"CLP", // Chilean Peso
	"COP", // Colombian Peso
	"IDR", // Indonesian Rupiah
	"ISK", // Icelandic Króna
	"JPY", // Japanese Yen
	"KRW", // South Korean Won
	"PYG", // Paraguayan Guarani
	"TWD", // New Taiwan Dollar
	"VND", // Vietnamese Dong
	"VUV", // Vanuatu Vatu
	"UGX", // Ugandan Shilling
];

/**
 * Major cryptocurrencies that require special "Human Price" correction logic.
 */
export const MAJOR_CRYPTOS = [
	"BTC",
	"ETH",
	"SOL",
	"BNB",
	"LTC",
	"BCH",
] as const;

/**
 * Checks if a currency is one of the major cryptocurrencies.
 */
export const isMajorCrypto = (currency: string) =>
	(MAJOR_CRYPTOS as readonly string[]).includes(currency.toUpperCase());

/**
 * Detects if a currency code is a known cryptocurrency.
 */
export function isCrypto(currency: string): boolean {
	const code = currency.toUpperCase();
	return code in CRYPTO_CURRENCIES;
}

/**
 * How the sign of a formatted amount is shown. "auto" shows a minus for
 * negative amounts only; "exceptZero" also shows a plus for positive ones.
 */
export type CurrencySignDisplay = "auto" | "exceptZero";

/**
 * Formats `amount` with the locale's own sign handling and splits the sign
 * from the digits, so the currency symbol can sit between them ("-AR$2,000"
 * rather than "AR$-2,000"). An amount that rounds to zero gets no sign.
 */
function formatSignedNumber(
	amount: number,
	locale: string,
	options: Intl.NumberFormatOptions,
	signDisplay: CurrencySignDisplay,
): { sign: string; digits: string } {
	const parts = partsOf(
		new Intl.NumberFormat(locale, { ...options, signDisplay }),
		amount,
	);
	const isSign = (p: Intl.NumberFormatPart) =>
		p.type === "minusSign" || p.type === "plusSign";
	const digits = parts
		.filter((p) => !isSign(p))
		.map((p) => p.value)
		.join("");
	const isZero = !parts.some(
		(p) =>
			(p.type === "integer" || p.type === "fraction") && /[1-9]/.test(p.value),
	);
	const sign = isZero
		? ""
		: parts
				.filter(isSign)
				.map((p) => p.value)
				.join("");
	return { sign, digits };
}

/**
 * Today's formatter for float major-unit amounts. New UI formats Money
 * through formatMoney (./format), which shows ISO codes ("ARS 1,234,567")
 * where this shows symbols ("AR$1,234,567"); call sites move over in S1/S4.
 *
 * Formats a currency amount using proper Intl.NumberFormat.
 * Automatically handles symbols, locale, and decimal digits based on currency.
 * For cryptocurrencies, it uses 8 decimal places and appends the ticker.
 * The sign follows the locale's pattern and goes before the symbol.
 */
export function formatCurrency(
	amount: number,
	currency = "USD",
	currencySymbolStyle: "native" | "standard" = "standard",
	smartFormatting = true,
	signDisplay: CurrencySignDisplay = "auto",
): string {
	const upperCurrency = currency.toUpperCase();
	const currencyData = CURRENCIES[upperCurrency as keyof typeof CURRENCIES];

	// Handle Cryptocurrency formatting
	if (isCrypto(upperCurrency)) {
		const { sign, digits } = formatSignedNumber(
			amount,
			"en-US",
			{ minimumFractionDigits: 2, maximumFractionDigits: 8 },
			signDisplay,
		);
		return `${sign}${digits} ${upperCurrency}`;
	}

	// Handle Fiat formatting
	// Get locale from home currency - for now we use a currency-appropriate locale
	const getLocaleForCurrency = (curr: string): string => {
		const localeMap: Record<string, string> = {
			USD: "en-US",
			CAD: "en-CA",
			EUR: "de-DE",
			GBP: "en-GB",
			JPY: "ja-JP",
			CHF: "de-CH",
			AUD: "en-AU",
			CNY: "zh-CN",
		};
		return localeMap[curr.toUpperCase()] || "en-US";
	};

	const locale = getLocaleForCurrency(upperCurrency);

	// Determine decimal digits based on currency and smart formatting preference
	let decimalDigits = currencyData?.decimal_digits ?? 2;

	if (smartFormatting && SMART_NO_DECIMAL_CURRENCIES.includes(upperCurrency)) {
		decimalDigits = 0;
	}

	// Choose symbol based on preference
	const symbol =
		currencySymbolStyle === "native"
			? currencyData?.symbol_native || currencyData?.symbol || upperCurrency
			: currencyData?.symbol || upperCurrency;

	const { sign, digits } = formatSignedNumber(
		amount,
		locale,
		{
			minimumFractionDigits: decimalDigits,
			maximumFractionDigits: decimalDigits,
		},
		signDisplay,
	);

	return `${sign}${symbol}${digits}`;
}
