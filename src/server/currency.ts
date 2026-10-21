/**
 * Legacy server-side conversion helpers. The formulas live in ~/lib/money,
 * which documents the rate convention; prefer it in new code.
 *
 * These wrappers keep their old contract: a missing or zero rate converts to
 * 0 instead of throwing, and results are not rounded.
 */
import {
	isValidRate,
	fromUSD as moneyFromUSD,
	toUSD as moneyToUSD,
} from "~/lib/money";

/**
 * Convert any currency amount to USD.
 */
export function toUSD(
	amount: number,
	currency: string,
	rate: number,
): number {
	if (currency === "USD") return amount;
	if (!isValidRate(rate)) return 0;
	return moneyToUSD(amount, currency, rate);
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
	if (!isValidRate(rate)) return 0;
	return moneyFromUSD(usdAmount, currency, rate);
}
