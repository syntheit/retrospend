import { roundMoney, tryConvertAmount } from "~/lib/money";

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

		const converted = tryConvertAmount(
			Math.abs(signed),
			b.currency,
			rateMap.get(b.currency),
			homeCurrency,
			rateMap.get(homeCurrency),
		);
		if (converted === null) {
			allConverted = false;
			continue;
		}
		const rounded = roundMoney(converted, homeCurrency);
		total += signed > 0 ? rounded : -rounded;
	}

	if (!allConverted && total === 0) return null;
	return { amount: total, canConvert: allConverted };
}

/**
 * True when nothing is owed either way. A home-currency total that could not
 * be computed (null, or only partly converted) never counts as settled: the
 * per-currency balances decide instead.
 */
export function isBalanceSettled(
	balances: BalanceEntry[],
	homeCurrencyTotal: { amount: number; canConvert: boolean } | null,
): boolean {
	if (balances.every((b) => b.balance === 0)) return true;
	return homeCurrencyTotal?.canConvert === true && homeCurrencyTotal.amount === 0;
}

/**
 * Build a settle button label like "Pay $20" or "Request $20".
 * Uses the home-currency total when it fully converts, with the verb taken from
 * its sign. Otherwise falls back to a per-currency balance in the requested
 * direction, and the verb follows that balance so the two always agree.
 */
export function formatSettleLabel(
	direction: "they_owe_you" | "you_owe_them" | "settled",
	homeCurrencyTotal: { amount: number; canConvert: boolean } | null,
	homeCurrency: string,
	balances: BalanceEntry[],
	formatCurrency: (amount: number, currency: string) => string,
	labels?: { pay: (amount: string) => string; request: (amount: string) => string },
): string {
	const converted =
		homeCurrencyTotal?.canConvert && homeCurrencyTotal.amount !== 0
			? homeCurrencyTotal
			: null;
	// The verb must match the amount shown: a converted total carries its own
	// sign, a per-currency fallback must be in the requested direction.
	const verb = converted
		? converted.amount > 0
			? "they_owe_you"
			: "you_owe_them"
		: direction;
	const fallback =
		balances.find((b) => b.direction === verb && b.balance !== 0) ??
		balances.find((b) => b.balance !== 0);
	const amount = converted
		? formatCurrency(Math.abs(converted.amount), homeCurrency)
		: fallback
			? formatCurrency(fallback.balance, fallback.currency)
			: "";
	const pay =
		(converted ? verb : (fallback?.direction ?? verb)) === "you_owe_them";
	if (labels) {
		return pay ? labels.pay(amount) : labels.request(amount);
	}
	return pay ? `Pay ${amount}` : `Request ${amount}`;
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
