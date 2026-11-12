/**
 * How many decimal places money in each currency keeps. Its own module so the
 * Decimal money code and the minor-unit code read it without importing each
 * other; money.ts re-exports it.
 */
import { getDecimalDigits, isCrypto } from "./currency-format";

// ISO 4217 minor units that differ from the default of 2.
const ZERO_DECIMAL = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"ISK",
	"JPY",
	"KMF",
	"KRW",
	"PYG",
	"RWF",
	"UGX",
	"UYI",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);
const THREE_DECIMAL = new Set([
	"BHD",
	"IQD",
	"JOD",
	"KWD",
	"LYD",
	"OMR",
	"TND",
]);
// Unidad de Fomento and Unidad Previsional, indexed units of account.
const FOUR_DECIMAL = new Set(["CLF", "UYW"]);

/**
 * Decimal places money in `currency` is kept to. ISO 4217 for fiat, 8 for
 * crypto (2 for stablecoins). Display formatting may show fewer.
 */
export function currencyDecimals(currency: string): number {
	const code = currency.toUpperCase();
	if (isCrypto(code)) return getDecimalDigits(code, false);
	if (ZERO_DECIMAL.has(code)) return 0;
	if (THREE_DECIMAL.has(code)) return 3;
	if (FOUR_DECIMAL.has(code)) return 4;
	return 2;
}
