import { convert } from "~/lib/currency-math";

type BalanceEntry = {
	balance: number;
	currency: string;
	direction: string;
};

/**
 * Convert an array of per-currency balances into a single home-currency total.
 * Returns null when there are no balances or when no conversion is possible.
 */
export function computeHomeCurrencyTotal(
	balances: BalanceEntry[],
	homeCurrency: string,
	rateMap: Map<string, number>,
): { amount: number; canConvert: boolean } | null {
	if (balances.length === 0) return null;

	if (balances.length === 1 && balances[0]!.currency === homeCurrency) {
		const b = balances[0]!;
		const signed = b.direction === "they_owe_you" ? b.balance : -b.balance;
		return { amount: signed, canConvert: true };
	}

	let total = 0;
	let allConverted = true;

	for (const b of balances) {
		const signed = b.direction === "they_owe_you" ? b.balance : -b.balance;

		if (b.currency === homeCurrency) {
			total += signed;
			continue;
		}

		const sourceRate = rateMap.get(b.currency);
		const targetRate =
			homeCurrency === "USD" ? undefined : rateMap.get(homeCurrency);

		if (!sourceRate || (homeCurrency !== "USD" && !targetRate)) {
			allConverted = false;
			continue;
		}

		const converted = convert(
			Math.abs(signed),
			b.currency,
			sourceRate,
			homeCurrency,
			targetRate,
		);
		total += signed > 0 ? converted : -converted;
	}

	if (!allConverted && total === 0) return null;
	return { amount: total, canConvert: allConverted };
}

/**
 * Build a settle button label like "Pay $20" or "Request $20".
 * Falls back to the primary balance currency if home currency conversion is unavailable.
 */
export function formatSettleLabel(
	direction: "they_owe_you" | "you_owe_them" | "settled",
	homeCurrencyTotal: { amount: number; canConvert: boolean } | null,
	homeCurrency: string,
	balances: BalanceEntry[],
	formatCurrency: (amount: number, currency: string) => string,
): string {
	const amount = homeCurrencyTotal?.canConvert
		? formatCurrency(Math.abs(homeCurrencyTotal.amount), homeCurrency)
		: balances[0]
			? formatCurrency(balances[0].balance, balances[0].currency)
			: "";
	return direction === "you_owe_them" ? `Pay ${amount}` : `Request ${amount}`;
}

/**
 * Build a currency -> rate lookup from an exchange-rates array.
 * Keeps the first (latest) rate for each currency.
 */
export function buildRateMap(
	allRates:
		| { currency: string; rate: { toString(): string } | string | number }[]
		| undefined,
): Map<string, number> {
	const map = new Map<string, number>();
	if (allRates) {
		for (const r of allRates) {
			if (!map.has(r.currency)) {
				map.set(r.currency, Number(r.rate));
			}
		}
	}
	return map;
}
