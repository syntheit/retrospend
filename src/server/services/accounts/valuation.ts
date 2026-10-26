/**
 * What account money is worth in the home currency, with Decimal math.
 *
 * The rule is today's Wealth dashboard rule (wealth.service.ts), so every
 * account values the same way it always has: the account's rate type picks
 * the rate of the account's currency (a custom type uses the stored rate as
 * typed; no table rate falls back to the stored rate), and the home currency
 * converts at its default pick. One extension for D3: a USD account has no
 * rate of its own, so its rate type picks the home currency's rate instead
 * (Wise valued at Official: USD 1 = ARS 1,412).
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { isCrypto } from "@retrospend/domain/currency-format";
import { type PickedRate, USD } from "@retrospend/domain/money";
import { dec } from "~/server/services/envelope/units";

export const CUSTOM_RATE_TYPE = "custom";

/** A rate lookup: the best stored rate of a currency on a date, preferring a type. */
export type RatePick = (
	currency: string,
	date: Date,
	preferredType?: string | null,
) => PickedRate | null;

export interface Valued {
	readonly currency: string;
	readonly rateType: string | null;
	/** The rate stored on the account (currency per USD, USD per coin). */
	readonly storedRate: { toString(): string } | number | null;
}

const validRate = (rate: Valued["storedRate"]) =>
	rate !== null && dec(String(rate)).gt(0) ? dec(String(rate)) : null;

/** USD per one unit, from a rate in the stored convention (fiat per USD, USD per coin). */
const usdPer = (currency: string, rate: Decimal) =>
	isCrypto(currency) ? rate : dec(1).div(rate);

function accountUsdPerUnit(
	pick: RatePick,
	valued: Valued,
	date: Date,
): Decimal | null {
	if (valued.currency === USD) return dec(1);
	const stored = validRate(valued.storedRate);
	if (valued.rateType === CUSTOM_RATE_TYPE && stored) {
		return usdPer(valued.currency, stored);
	}
	const picked = pick(valued.currency, date, valued.rateType);
	if (picked && picked.rate > 0) {
		return usdPer(valued.currency, dec(String(picked.rate)));
	}
	return stored ? usdPer(valued.currency, stored) : null;
}

/** Home units one unit of `valued.currency` is worth on `date`; null when a rate is missing (never 1). */
export function homePerUnit(
	pick: RatePick,
	valued: Valued,
	homeCurrency: string,
	date: Date,
): Decimal | null {
	if (valued.currency === homeCurrency) return dec(1);
	const account = accountUsdPerUnit(pick, valued, date);
	if (!account) return null;
	if (homeCurrency === USD) return account;
	const homeType = valued.currency === USD ? valued.rateType : null;
	const home = pick(homeCurrency, date, homeType);
	if (!home || !(home.rate > 0)) return null;
	return account.div(usdPer(homeCurrency, dec(String(home.rate))));
}

/** `units` of `valued.currency` in the home currency, unrounded; null when a rate is missing. */
export function homeValue(
	pick: RatePick,
	valued: Valued,
	units: Decimal,
	homeCurrency: string,
	date: Date,
): Decimal | null {
	const perUnit = homePerUnit(pick, valued, homeCurrency, date);
	return perUnit ? units.mul(perUnit) : null;
}
