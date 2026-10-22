/**
 * Owed to you, one number everywhere (MONEY-MOVES I8, owner answer "net per
 * person, everyone included, identical to People's number"): each person's
 * balance is netted across currencies at the reference rate into the home
 * currency, then the people who owe you add up to Owed to you and the
 * people you owe add up to You owe. The two are never netted together.
 */
import { sumMinor } from "~/server/services/envelope/units";
import { toPaymentCurrency } from "./allocate";
import type { Minor, Quote } from "./types";

/**
 * One person's net in the home currency, positive = they owe you. Null when
 * a currency they owe in has no reference quote: a missing rate is never 1.
 */
export function netInHome(
	overall: ReadonlyMap<string, Minor>,
	homeCurrency: string,
	quotes: ReadonlyMap<string, Quote>,
): Minor | null {
	const parts: Minor[] = [];
	for (const [currency, minor] of overall) {
		const quote = currency === homeCurrency ? null : quotes.get(currency);
		if (quote === undefined) return null;
		parts.push(toPaymentCurrency(minor, currency, homeCurrency, quote));
	}
	return sumMinor(parts);
}

export interface OwedTotals {
	readonly owedToYou: Minor;
	readonly youOwe: Minor;
}

/** Owed to you and You owe from per-person nets; both are non-negative. */
export function owedTotals(nets: readonly Minor[]): OwedTotals {
	return {
		owedToYou: sumMinor(nets.filter((n) => n > 0)),
		youOwe: sumMinor(nets.filter((n) => n < 0).map((n) => -n)),
	};
}
