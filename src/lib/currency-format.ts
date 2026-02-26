import { CURRENCIES } from "./currencies";

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

export function getCurrencyName(currency: string): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	return currencyData?.name || currency.toUpperCase();
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
 * Formats a currency amount using proper Intl.NumberFormat with currency style.
 * Automatically handles symbols, locale, and decimal digits based on currency.
 */
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
 * Detects if a currency code is likely a cryptocurrency.
 * Currently checks if it's NOT in our list of standard fiat currencies.
 */
export function isCrypto(currency: string): boolean {
	const code = currency.toUpperCase();
	return !CURRENCIES[code as keyof typeof CURRENCIES];
}

/**
 * Formats a currency amount using proper Intl.NumberFormat.
 * Automatically handles symbols, locale, and decimal digits based on currency.
 * For cryptocurrencies, it uses 8 decimal places and appends the ticker.
 */
export function formatCurrency(
	amount: number,
	currency = "USD",
	currencySymbolStyle: "native" | "standard" = "standard",
	smartFormatting = true,
): string {
	const upperCurrency = currency.toUpperCase();
	const currencyData = CURRENCIES[upperCurrency as keyof typeof CURRENCIES];

	// Handle Cryptocurrency formatting
	if (isCrypto(upperCurrency)) {
		const formattedValue = new Intl.NumberFormat("en-US", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 8,
		}).format(amount);
		return `${formattedValue} ${upperCurrency}`;
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

	// Format the number part
	const formattedNumber = new Intl.NumberFormat(locale, {
		minimumFractionDigits: decimalDigits,
		maximumFractionDigits: decimalDigits,
	}).format(amount);

	// Combine symbol and number
	return `${symbol}${formattedNumber}`;
}
