/**
 * Money math in exact decimals: the one implementation of conversion and
 * rounding. Stored figures and totals use these functions; the number
 * functions in money.ts wrap them for display and form drafts only.
 *
 * Rates follow the stored convention (money.ts header): fiat in units per
 * USD, crypto in USD per coin, USD always 1. A conversion divides once, so
 * an exact tie stays a tie (4.5 at 3 per USD is 1.5 USD, never
 * 1.4999...9). Rounding is half to even on the magnitude, so it is sign
 * symmetric, and a result never reads "-0".
 */
import { currencyDecimals } from "./currency-decimals";
import { isCrypto } from "./currency-format";
import { Dec, type Decimal, type DecimalInput, dec } from "./precise-decimal";

export const USD = "USD";

export class MissingRateError extends Error {
	/** Every currency that could not convert, sorted; `currency` is the first. */
	public readonly currencies: readonly string[];

	constructor(
		public readonly currency: string,
		currencies: readonly string[] = [currency],
	) {
		const all = [...new Set([currency, ...currencies])].sort();
		super(`No exchange rate available for ${all.join(", ")}`);
		this.name = "MissingRateError";
		this.currencies = all;
	}
}

export type RateInput = DecimalInput | null | undefined;

/** A usable rate (finite, above zero) as a Decimal, else MissingRateError; never 1. */
function rateOf(currency: string, rate: RateInput): Decimal {
	const r = rate === null || rate === undefined ? null : dec(rate);
	if (!r?.isFinite() || !r.gt(0)) throw new MissingRateError(currency);
	return r;
}

/**
 * A currency's rate as a fraction of USD per unit: fiat 1 / rate, crypto
 * rate / 1, USD 1 / 1. Kept apart so a chain of conversions divides once.
 */
export function usdFractionDec(
	currency: string,
	rate: RateInput,
): [Decimal, Decimal] {
	if (currency === USD) return [new Dec(1), new Dec(1)];
	const r = rateOf(currency, rate);
	return isCrypto(currency) ? [r, new Dec(1)] : [new Dec(1), r];
}

/** USD value of one unit of `currency`, given its stored rate. */
export function usdPerUnitDec(currency: string, rate: RateInput): Decimal {
	const [num, den] = usdFractionDec(currency, rate);
	return num.div(den);
}

/** Stored rate for `currency` given the USD value of one unit. */
export function rateFromUsdPerUnitDec(
	currency: string,
	usdValue: DecimalInput,
): Decimal {
	if (currency === USD) return new Dec(1);
	const v = rateOf(currency, usdValue);
	return isCrypto(currency) ? v : new Dec(1).div(v);
}

/** An amount in USD (unrounded). */
export function toUSDDec(
	amount: DecimalInput,
	currency: string,
	rate: RateInput,
): Decimal {
	return convertDec(amount, currency, rate, USD, 1);
}

/** A USD amount in `currency` (unrounded). */
export function fromUSDDec(
	usd: DecimalInput,
	currency: string,
	rate: RateInput,
): Decimal {
	return convertDec(usd, USD, 1, currency, rate);
}

/**
 * An amount converted between any two currencies through USD (unrounded):
 * amount x (USD per `from`) / (USD per `to`), as one division of two
 * products.
 */
export function convertDec(
	amount: DecimalInput,
	from: string,
	fromRate: RateInput,
	to: string,
	toRate: RateInput,
): Decimal {
	if (from === to) return dec(amount);
	const [fromNum, fromDen] = usdFractionDec(from, fromRate);
	const [toNum, toDen] = usdFractionDec(to, toRate);
	return dec(amount).mul(fromNum).mul(toDen).div(fromDen.mul(toNum));
}

/** Units of `to` per one unit of `from` (unrounded). */
export function crossRateDec(
	from: string,
	fromRate: RateInput,
	to: string,
	toRate: RateInput,
): Decimal {
	return convertDec(1, from, fromRate, to, toRate);
}

/** `value` at `places` decimals, half to even; -0 becomes 0. */
function roundTo(value: DecimalInput, places: number): Decimal {
	// plus(0) turns -0 into 0 under every rounding mode but floor.
	return dec(value).toDecimalPlaces(places, Dec.ROUND_HALF_EVEN).plus(0);
}

/** An amount at its currency's precision (currencyDecimals), half to even. */
export function roundMoneyDec(value: DecimalInput, currency: string): Decimal {
	return roundTo(value, currencyDecimals(currency));
}

/** A USD amount to cents, half to even. */
export function roundUSDDec(value: DecimalInput): Decimal {
	return roundTo(value, 2);
}

/** A rate at a column's scale (6 for exchangeRate, 12 for homeRate), half to even. */
export function roundRateDec(value: DecimalInput, scale: number): Decimal {
	return roundTo(value, scale);
}

/** amountInUSD as stored: converted and rounded to cents, half to even. */
export function computeAmountInUSDDec(
	amount: DecimalInput,
	currency: string,
	rate: RateInput,
): Decimal {
	return roundUSDDec(toUSDDec(amount, currency, rate));
}
