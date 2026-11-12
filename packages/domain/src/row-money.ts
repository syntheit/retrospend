/**
 * Shaping stored amounts into the Money a row or a figure shows: stored
 * Decimals to minor units, home-currency values under the totals rule. Pure,
 * so the server and a device shape the same row the same way (R9); clients
 * only format what comes out.
 */
import { categoryTone } from "./category-tone";
import { fromUSD, isValidRate, toUSD, USD } from "./money";
import { type Money, roundedMinor, toMinor } from "./money-minor";
import type { DecimalInput } from "./precise-decimal";

/** A category as rows show it: the color is a category-n token number. */
export type CategoryRefDTO = {
	id: string | null;
	name: string | null;
	icon: string | null;
	tone: number;
};

/** A stored amount as Money, rounded half to even to its currency (roundedMinor). */
export function decimalMoney(value: DecimalInput, currency: string): Money {
	return { minor: roundedMinor(value, currency), currency };
}

/** A converted major-units value as Money (half to even). */
export function numberMoney(value: number, currency: string): Money {
	return { minor: toMinor(value, currency), currency };
}

/** Rates the row shaping needs: units per USD, null when unknown. */
export type HomeRates = {
	home: string;
	/** Units of the home currency per USD. */
	homeRate: number | null;
};

/** A USD value in home major units (unrounded), or null without a home rate. */
function usdToHome(usd: number, rates: HomeRates): number | null {
	if (rates.home === USD) return usd;
	if (!isValidRate(rates.homeRate)) return null;
	return fromUSD(usd, rates.home, rates.homeRate);
}

/** A stored USD value in the home currency, or null without a home rate. */
export function homeFromUSD(usd: number, rates: HomeRates): Money | null {
	const v = usdToHome(usd, rates);
	return v === null ? null : numberMoney(v, rates.home);
}

/**
 * An amount in `currency` at `rate` (units per USD) in home major units,
 * unrounded so sums round once; null when a rate is missing.
 */
export function homeMajor(
	amount: number,
	currency: string,
	rate: number | null,
	rates: HomeRates,
): number | null {
	if (currency === rates.home) return amount;
	if (currency !== USD && !isValidRate(rate)) return null;
	return usdToHome(toUSD(amount, currency, rate ?? 1), rates);
}

/** homeMajor as Money. */
export function homeOf(
	amount: number,
	currency: string,
	rate: number | null,
	rates: HomeRates,
): Money | null {
	const v = homeMajor(amount, currency, rate, rates);
	return v === null ? null : numberMoney(v, rates.home);
}

/** A category as a row shows it, or null for none. `color` is the stored color name. */
export function categoryRef(
	c: {
		id: string;
		name: string;
		color: string;
		icon: string | null;
	} | null,
): CategoryRefDTO | null {
	if (!c) return null;
	return {
		id: c.id,
		name: c.name,
		icon: c.icon,
		tone: categoryTone(c.color),
	};
}

/** The number of a stored Decimal or text, as the figures' float sums read it. */
export const numberOf = (value: DecimalInput): number =>
	Number(value.toString());
