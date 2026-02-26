export interface RatesData {
	rates: Record<string, number>;
	cryptoRates: Record<string, number>;
}

/**
 * Universal conversion utility for Fiat and Crypto currencies.
 * Logic uses USD as the internal pivot.
 *
 * Math Rubric (CRITICAL):
 * - Fiat (rates): Stored as Units per 1 USD (e.g., ARS = 1500)
 *   - Fiat to USD: amount / rates[currency]
 *   - USD to Fiat: usdValue * rates[currency]
 * - Crypto (cryptoRates): Stored as USD per 1 Coin (e.g., BTC = 65000)
 *   - Crypto to USD: amount * cryptoRates[currency]
 *   - USD to Crypto: usdValue / cryptoRates[currency]
 */
export function convertCurrency(
	amount: number,
	from: string,
	to: string,
	ratesData: RatesData,
): number {
	if (from === to) return amount;

	// 1. Convert source amount to USD (Pivot)
	let usdValue: number;

	if (from === "USD") {
		usdValue = amount;
	} else if (ratesData.cryptoRates[from] !== undefined) {
		// Crypto to USD: Amount * cryptoRates[currency]
		usdValue = amount * (ratesData.cryptoRates[from] || 0);
	} else {
		// Fiat to USD: Amount / rates[currency]
		usdValue = amount / (ratesData.rates[from] || 1);
	}

	// 2. Convert USD to target currency
	if (to === "USD") {
		return usdValue;
	}

	if (ratesData.cryptoRates[to] !== undefined) {
		// USD to Crypto: usdValue / cryptoRates[currency]
		const rate = ratesData.cryptoRates[to] || 1;
		return usdValue / rate;
	}

	// USD to Fiat: usdValue * rates[currency]
	return usdValue * (ratesData.rates[to] || 1);
}

/**
 * Enforcer utility following the specific rubric for base currency calculation.
 */
export function calculateBaseValue(
	amount: number,
	currency: string,
	baseCurrency: string,
	rates: Record<string, number>,
	cryptoRates: Record<string, number>,
): number {
	return convertCurrency(amount, currency, baseCurrency, {
		rates,
		cryptoRates,
	});
}

/**
 * Helper to check if a currency is a cryptocurrency based on the rates data or standard list.
 */
export function isCryptoCurrency(
	currency: string,
	ratesData?: RatesData,
): boolean {
	if (currency === "USD") return false;

	if (ratesData?.cryptoRates && currency in ratesData.cryptoRates) {
		return true;
	}

	// Fallback to standard check if no rates data provided
	// In Retrospend, cryptos are generally everything NOT in the standard fiat list
	// but we can be more specific if we had a list.
	// For now, let's keep it consistent with the existing heuristic if ratesData is missing.
	return false;
}
