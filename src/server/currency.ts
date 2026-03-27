/**
 * CENTRALIZED SERVER-SIDE CURRENCY CONVERSION
 *
 * This is the server-side equivalent of `useCurrencyConversion` (client hook).
 * Uses `isCrypto(currency)` to determine conversion direction: NEVER relies
 * on the exchange rate's `type` field from the database.
 *
 * DATABASE STORAGE RUBRIC (must never change):
 * - Fiat rates: Stored as Units per 1 USD (e.g., ARS = 1467.95)
 * - Crypto rates: Stored as USD per 1 Unit (e.g., BTC = 50000)
 *
 * CONVERSION FORMULAS:
 * - Fiat → USD:   amount / rate
 * - Crypto → USD: amount * rate
 * - USD → Fiat:   usdAmount * rate
 * - USD → Crypto: usdAmount / rate
 */
import { isCrypto } from "~/lib/currency-format";

/**
 * Convert any currency amount to USD.
 */
export function toUSD(
	amount: number,
	currency: string,
	rate: number,
): number {
	if (currency === "USD") return amount;
	if (!rate || rate === 0) return 0;
	return isCrypto(currency) ? amount * rate : amount / rate;
}

/**
 * Convert a USD amount to any currency.
 */
export function fromUSD(
	usdAmount: number,
	currency: string,
	rate: number,
): number {
	if (currency === "USD") return usdAmount;
	if (!rate || rate === 0) return 0;
	return isCrypto(currency) ? usdAmount / rate : usdAmount * rate;
}
