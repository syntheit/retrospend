import { fromMinorUnits, toMinorUnits } from "./money";

/**
 * The per-person amount to show for an even split ("Each person pays X").
 *
 * An even split hands out whole minor units of the currency (cents, or
 * satoshis for BTC): when the total does not divide evenly, some people pay
 * one unit more than others (see resolveSplits). The summary shows the
 * amount rounded to the nearest unit, which is what most people pay. Flooring it instead understated the share whenever more than
 * half the people pay the extra cent ($200 / 3 showed $66.66 while two of the
 * three pay $66.67).
 */
export function evenSharePerPerson(
	amount: number,
	count: number,
	currency: string,
): number {
	if (count <= 0) return 0;
	return fromMinorUnits(
		Math.round(toMinorUnits(amount, currency) / count),
		currency,
	);
}
