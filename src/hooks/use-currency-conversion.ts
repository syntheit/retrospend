"use client";

import { useMemo } from "react";
import {
	convert,
	fromUSD,
	getDisplayRate,
	toUSD,
} from "~/lib/currency-math";

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
	return useMemo(() => ({ toUSD, fromUSD, convert, getDisplayRate }), []);
}
