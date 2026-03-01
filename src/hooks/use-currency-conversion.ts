"use client";

import { useMemo } from "react";
import { isCrypto } from "~/lib/currency-format";

/**
 * ⚠️ CENTRALIZED CURRENCY CONVERSION HOOK - USE THIS TO PREVENT EXCHANGE RATE BUGS ⚠️
 *
 * CRITICAL: This hook is the SINGLE SOURCE OF TRUTH for all currency conversions in React components.
 * Do NOT implement conversion logic inline anywhere else in the codebase.
 *
 * DATABASE STORAGE RUBRIC (must never change):
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * - Fiat rates: Stored as Units per 1 USD
 *   Example: ARS = 1415 means 1415 Argentine Pesos = 1 USD
 * - Crypto rates: Stored as USD per 1 Unit
 *   Example: BTC = 50000 means 1 Bitcoin = 50000 USD
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * CONVERSION FORMULAS:
 * - Fiat → USD: amount / exchangeRate
 *   Example: 5000 ARS → USD = 5000 / 1415 = 3.53 USD
 * - Crypto → USD: amount * exchangeRate
 *   Example: 0.5 BTC → USD = 0.5 * 50000 = 25000 USD
 * - USD → Fiat: amount * exchangeRate
 *   Example: 100 USD → ARS = 100 * 1415 = 141500 ARS
 * - USD → Crypto: amount / exchangeRate
 *   Example: 25000 USD → BTC = 25000 / 50000 = 0.5 BTC
 *
 * USAGE EXAMPLES:
 * ```tsx
 * const { toUSD, fromUSD, convert } = useCurrencyConversion();
 *
 * // Convert expense amount to USD
 * const usdAmount = toUSD(5000, "ARS", 1415); // Returns 3.53
 *
 * // Convert USD to user's home currency
 * const homeAmount = fromUSD(100, "ARS", 1415); // Returns 141500
 *
 * // Convert between any two currencies
 * const eurAmount = convert(5000, "ARS", 1415, "EUR", 0.92); // Via USD
 * ```
 *
 * COMMON PITFALLS TO AVOID:
 * ❌ DO NOT multiply when you should divide (or vice versa)
 * ❌ DO NOT implement conversion logic inline in components
 * ❌ DO NOT confuse displayMode with conversion logic
 * ✅ DO use this hook for ALL currency conversions in components
 * ✅ DO trust the isCrypto() function to determine the correct formula
 */
export function useCurrencyConversion() {
	return useMemo(
		() => ({
			/**
			 * Convert any currency amount to USD
			 * @param amount The amount in the foreign currency
			 * @param currency The foreign currency code
			 * @param exchangeRate The exchange rate from the database
			 * @returns Amount in USD
			 */
			toUSD: (
				amount: number,
				currency: string,
				exchangeRate: number | undefined,
			): number => {
				if (!amount || amount === 0) return 0;
				if (currency === "USD") return amount;
				if (!exchangeRate || exchangeRate === 0) return 0;

				// RUBRIC: Crypto to USD = multiply, Fiat to USD = divide
				const usdValue = isCrypto(currency)
					? amount * exchangeRate
					: amount / exchangeRate;

				return Math.round(usdValue * 100) / 100;
			},

			/**
			 * Convert USD amount to any currency
			 * @param usdAmount The amount in USD
			 * @param targetCurrency The target currency code
			 * @param exchangeRate The exchange rate from the database
			 * @returns Amount in target currency
			 */
			fromUSD: (
				usdAmount: number,
				targetCurrency: string,
				exchangeRate: number | undefined,
			): number => {
				if (!usdAmount || usdAmount === 0) return 0;
				if (targetCurrency === "USD") return usdAmount;
				if (!exchangeRate || exchangeRate === 0) return 0;

				// RUBRIC: USD to Crypto = divide, USD to Fiat = multiply
				const targetValue = isCrypto(targetCurrency)
					? usdAmount / exchangeRate
					: usdAmount * exchangeRate;

				return Math.round(targetValue * 100) / 100;
			},

			/**
			 * Convert between any two currencies via USD
			 * @param amount The amount in the source currency
			 * @param sourceCurrency The source currency code
			 * @param sourceRate The exchange rate for the source currency
			 * @param targetCurrency The target currency code
			 * @param targetRate The exchange rate for the target currency
			 * @returns Amount in target currency
			 */
			convert: (
				amount: number,
				sourceCurrency: string,
				sourceRate: number | undefined,
				targetCurrency: string,
				targetRate: number | undefined,
			): number => {
				if (!amount || amount === 0) return 0;
				if (sourceCurrency === targetCurrency) return amount;

				// Convert to USD first
				let usdAmount: number;
				if (sourceCurrency === "USD") {
					usdAmount = amount;
				} else if (!sourceRate || sourceRate === 0) {
					return 0;
				} else {
					usdAmount = isCrypto(sourceCurrency)
						? amount * sourceRate
						: amount / sourceRate;
				}

				// Convert from USD to target
				if (targetCurrency === "USD") {
					return Math.round(usdAmount * 100) / 100;
				} else if (!targetRate || targetRate === 0) {
					return 0;
				} else {
					const targetValue = isCrypto(targetCurrency)
						? usdAmount / targetRate
						: usdAmount * targetRate;
					return Math.round(targetValue * 100) / 100;
				}
			},

			/**
			 * Get the display rate for showing exchange rates in the UI
			 * @param exchangeRate The raw exchange rate from the database
			 * @param currency The currency code
			 * @param displayMode How to display the rate:
			 *   - "foreign-to-usd": Shows "1 FOREIGN = X USD" (inverts fiat rates)
			 *   - "usd-to-foreign": Shows "1 USD = X FOREIGN" (uses raw fiat rates)
			 * @returns The display rate
			 */
			getDisplayRate: (
				exchangeRate: number | undefined,
				currency: string,
				displayMode: "foreign-to-usd" | "usd-to-foreign" = "usd-to-foreign",
			): number => {
				if (!exchangeRate || exchangeRate === 0) return 0;
				if (currency === "USD") return 1;

				// Crypto rates are always stored as USD per unit, so they display the same way
				if (isCrypto(currency)) {
					return exchangeRate;
				}

				// Fiat rates are stored as Units per USD
				// - "usd-to-foreign": 1 USD = X FOREIGN (raw rate)
				// - "foreign-to-usd": 1 FOREIGN = X USD (inverted)
				return displayMode === "foreign-to-usd" ? 1 / exchangeRate : exchangeRate;
			},
		}),
		[],
	);
}
