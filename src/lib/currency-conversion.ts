export interface RatesData {
	rates: Record<string, number>;
	cryptoRates: Record<string, number>;
}

/**
 * Universal conversion utility for Fiat and Crypto currencies.
 * Logic uses USD as the base currency.
 *
 * Math Logic (Base USD):
 * - To USD:
 *   - If from is Fiat: amount / (rates[from] || 1)
 *   - If from is Crypto: amount * (cryptoRates[from] || 0)
 * - From USD:
 *   - If to is Fiat: usdValue * (rates[to] || 1)
 *   - If to is Crypto: usdValue / (cryptoRates[to] || 1)
 *
 * @param amount - The amount to convert
 * @param from - The source currency code
 * @param to - The target currency code
 * @param ratesData - Object containing fiat and crypto rates
 * @returns The converted amount
 */
export function convertCurrency(
	amount: number,
	from: string,
	to: string,
	ratesData: RatesData,
): number {
	if (from === to) return amount;

	// 1. Convert source amount to USD
	let usdValue: number;

	if (from === "USD") {
		usdValue = amount;
	} else if (ratesData.cryptoRates[from] !== undefined) {
		// Crypto: rates refer to USD price of 1 unit
		usdValue = amount * (ratesData.cryptoRates[from] || 0);
	} else {
		// Fiat: rates refer to units per 1 USD
		usdValue = amount / (ratesData.rates[from] || 1);
	}

	// 2. Convert USD to target currency
	if (to === "USD") {
		return usdValue;
	}

	if (ratesData.cryptoRates[to] !== undefined) {
		// Crypto: divide USD value by unit price
		// Fallback to 1 to prevent division by zero, though a rate of 0 is effectively invalid
		const rate = ratesData.cryptoRates[to] || 1;
		return usdValue / rate;
	}

	// Fiat: multiply USD value by units per USD
	return usdValue * (ratesData.rates[to] || 1);
}

/**
 * Helper to check if a currency is a cryptocurrency based on the rates data.
 */
export function isCryptoCurrency(
	currency: string,
	ratesData: RatesData,
): boolean {
	return (
		ratesData.cryptoRates !== undefined &&
		currency in ratesData.cryptoRates &&
		currency !== "USD"
	);
}
