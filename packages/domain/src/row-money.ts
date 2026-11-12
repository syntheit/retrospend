/**
 * Shaping stored amounts into the Money a row or a figure shows: stored
 * Decimals to minor units, home-currency values under the totals rule. Pure,
 * so the server and a device shape the same row the same way (R9); clients
 * only format what comes out.
 */
import { categoryTone } from "./category-tone";
import { convertDec, fromUSDDec, hasRate, type RateInput } from "./money-dec";
import { type Money, roundedMinor } from "./money-minor";
import { type Decimal, type DecimalInput, dec } from "./precise-decimal";

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

/** Rates the row shaping needs: units per USD, null when unknown. */
export type HomeRates = {
	home: string;
	/** Units of the home currency per USD. */
	homeRate: number | null;
};

/**
 * A stored USD value in the home currency, or null without a home rate. One
 * conversion, rounded half to even once.
 */
export function homeFromUSD(usd: DecimalInput, rates: HomeRates): Money | null {
	if (!hasRate(rates.home, rates.homeRate)) return null;
	return decimalMoney(fromUSDDec(usd, rates.home, rates.homeRate), rates.home);
}

/**
 * An amount in `currency` at `rate` (stored convention) in home major units,
 * exact so sums round once; null when a rate is missing. One division, so an
 * exact tie stays a tie.
 */
export function homeDec(
	amount: DecimalInput,
	currency: string,
	rate: RateInput,
	rates: HomeRates,
): Decimal | null {
	if (currency === rates.home) return dec(amount);
	if (!hasRate(currency, rate) || !hasRate(rates.home, rates.homeRate))
		return null;
	return convertDec(amount, currency, rate, rates.home, rates.homeRate);
}

/** homeDec as Money, rounded half to even. */
export function homeOf(
	amount: DecimalInput,
	currency: string,
	rate: RateInput,
	rates: HomeRates,
): Money | null {
	const v = homeDec(amount, currency, rate, rates);
	return v === null ? null : decimalMoney(v, rates.home);
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
