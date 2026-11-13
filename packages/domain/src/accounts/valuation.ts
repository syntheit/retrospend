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
 *
 * One function per figure: an account's value in the home currency is
 * `homeValue`, one division of two products (units x numerator / denominator),
 * so an exact tie stays a tie (1 EUR at 3 per USD into JPY at 16.5 is 5.5,
 * never 5.499...9). The Wealth dashboard, the net worth figure and API v1
 * all read it. Code that stores a per-unit rate takes the quotient with
 * `ratePerUnit`.
 */
import { type PickedRate, rateLookup, rateRowsByCurrency, USD } from "../money";
import { usdFractionDec } from "../money-dec";
import { type Decimal, dec } from "../precise-decimal";

export const CUSTOM_RATE_TYPE = "custom";

/** A rate lookup: the best stored rate of a currency on a date, preferring a type. */
export type RatePick = (
	currency: string,
	date: Date,
	preferredType?: string | null,
) => PickedRate | null;

/** One stored rate of one currency (an exchange_rate row). */
export interface PickRateRow {
	readonly currency: string;
	readonly type: string;
	readonly rate: number;
	readonly date: Date;
}

/**
 * A rate lookup over rate rows held in memory: USD is 1, any other currency
 * picks from all of its rows (rateLookup, the one picker). The server's batch lookup
 * (findExchangeRatesForDates) is this over the rows of the currencies it
 * needs, so a device with the same rows prices at the same rates. It is not
 * the windowed single lookup (rateWindow): the batch one never limited the
 * rows it sees.
 */
export function ratePickFromRows(rows: readonly PickRateRow[]): RatePick {
	return rateLookup(
		rateRowsByCurrency(
			rows,
			rows.map((r) => r.currency),
		),
	);
}

export interface Valued {
	readonly currency: string;
	readonly rateType: string | null;
	/** The rate stored on the account (currency per USD, USD per coin). */
	readonly storedRate: { toString(): string } | number | null;
}

/** A conversion rate kept as numerator and denominator, so a value divides once. */
export type HomeFraction = readonly [num: Decimal, den: Decimal];

const validRate = (rate: Valued["storedRate"]) =>
	rate !== null && dec(String(rate)).gt(0) ? dec(String(rate)) : null;

/** USD per one unit of the account's currency; null when no rate values it. */
function accountUsd(
	pick: RatePick,
	valued: Valued,
	date: Date,
): HomeFraction | null {
	if (valued.currency === USD) return usdFractionDec(USD, 1);
	const stored = validRate(valued.storedRate);
	if (valued.rateType === CUSTOM_RATE_TYPE && stored) {
		return usdFractionDec(valued.currency, stored);
	}
	const picked = pick(valued.currency, date, valued.rateType);
	if (picked && picked.rate > 0) {
		return usdFractionDec(valued.currency, dec(String(picked.rate)));
	}
	return stored ? usdFractionDec(valued.currency, stored) : null;
}

/** USD per one unit of the home currency; null when it has no rate. */
function homeUsd(
	pick: RatePick,
	valued: Valued,
	homeCurrency: string,
	date: Date,
): HomeFraction | null {
	if (homeCurrency === USD) return usdFractionDec(USD, 1);
	const homeType = valued.currency === USD ? valued.rateType : null;
	const home = pick(homeCurrency, date, homeType);
	if (!home || !(home.rate > 0)) return null;
	return usdFractionDec(homeCurrency, dec(String(home.rate)));
}

/**
 * Home units one unit of `valued.currency` is worth on `date`, as a
 * fraction; null when a rate is missing (never 1).
 */
export function homePerUnit(
	pick: RatePick,
	valued: Valued,
	homeCurrency: string,
	date: Date,
): HomeFraction | null {
	if (valued.currency === homeCurrency) return [dec(1), dec(1)];
	const account = accountUsd(pick, valued, date);
	if (!account) return null;
	const home = homeUsd(pick, valued, homeCurrency, date);
	if (!home) return null;
	return [account[0].mul(home[1]), account[1].mul(home[0])];
}

/**
 * The per-unit rate as one Decimal, for a rate that is stored or shown (the
 * v1 12 dp rate, a rate field). An amount never multiplies by it: the
 * quotient is rounded to 40 digits, which can land just off an exact tie. Use
 * `byFraction`, `unitsForHome` or `homeValue`.
 */
export function ratePerUnit(fraction: HomeFraction): Decimal {
	return fraction[0].div(fraction[1]);
}

/** `units` at the per-unit fraction: units x num / den, one division (D3). */
export function byFraction(units: Decimal, fraction: HomeFraction): Decimal {
	return units.mul(fraction[0]).div(fraction[1]);
}

/** The units that are worth `home` at the per-unit fraction: home x den / num, one division. */
export function unitsForHome(home: Decimal, fraction: HomeFraction): Decimal {
	return home.mul(fraction[1]).div(fraction[0]);
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
	return perUnit ? byFraction(units, perUnit) : null;
}

/**
 * The currency a valuation lacks a rate for: the account's own first, then
 * the home currency's; null when `homeValue` can price it.
 */
export function missingRateOf(
	pick: RatePick,
	valued: Valued,
	homeCurrency: string,
	date: Date,
): string | null {
	if (valued.currency === homeCurrency) return null;
	if (!accountUsd(pick, valued, date)) return valued.currency;
	return homeUsd(pick, valued, homeCurrency, date) ? null : homeCurrency;
}
