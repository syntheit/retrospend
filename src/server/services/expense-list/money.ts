/**
 * Server-side shaping for row DTOs: stored Decimals to Money in minor units,
 * home-currency values under the totals rule, and the category color token.
 * Clients only format what comes out of here (R9).
 */

import { categoryTone } from "@retrospend/domain/category-tone";
import {
	currencyDecimals,
	fromUSD,
	isValidRate,
	toUSD,
	USD,
} from "@retrospend/domain/money";
import { type Money, toMinor } from "@retrospend/domain/money-minor";
import { type CategoryColor, Prisma } from "~prisma";
import type { CategoryRefDTO } from "./types";

type DecimalLike = Prisma.Decimal | number | string;

/**
 * A stored amount as Money. Columns keep 8 decimals for every currency, so
 * a share split three ways (12.73333333) is rounded half to even to the
 * currency first, the domain's one rule; toMinor refuses to round itself.
 */
export function decimalMoney(value: DecimalLike, currency: string): Money {
	const rounded = new Prisma.Decimal(value).toDecimalPlaces(
		currencyDecimals(currency),
		Prisma.Decimal.ROUND_HALF_EVEN,
	);
	return { minor: toMinor(rounded.toFixed(), currency), currency };
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

export function categoryRef(
	c: {
		id: string;
		name: string;
		color: CategoryColor;
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
