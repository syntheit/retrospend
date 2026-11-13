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

/**
 * Stored rate for `currency` from a USD amount and the amount of `currency`
 * it prices (a file's USD column): one division, fiat amount / USD, crypto
 * USD / amount, never amount x (1 / USD). No finite rate above zero (a zero
 * amount or USD, or signs that differ) throws MissingRateError, never 1.
 */
export function rateFromUsdAmountDec(
	currency: string,
	amountInUSD: DecimalInput,
	amount: DecimalInput,
): Decimal {
	if (currency === USD) return new Dec(1);
	const usd = dec(amountInUSD);
	const units = dec(amount);
	return rateOf(currency, isCrypto(currency) ? usd.div(units) : units.div(usd));
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

/**
 * Units of `to` per one unit of `from` as a [numerator, denominator] pair,
 * undivided, so an amount converts with one division (amount x num / den) and
 * an exact tie stays a tie. NOK at 9 per USD into JPY at 16.5 is 16.5 / 9:
 * 3 NOK x 16.5 / 9 is 5.5, where 3 x (the 40-digit quotient 1.8333...3) is
 * 5.4999...9.
 */
export function crossFractionDec(
	from: string,
	fromRate: RateInput,
	to: string,
	toRate: RateInput,
): [Decimal, Decimal] {
	const [fromNum, fromDen] = usdFractionDec(from, fromRate);
	const [toNum, toDen] = usdFractionDec(to, toRate);
	return [fromNum.mul(toDen), fromDen.mul(toNum)];
}

/**
 * Units of `to` per one unit of `from` (unrounded). For a rate that is stored
 * or shown; an amount converts with crossFractionDec or convertDec.
 */
export function crossRateDec(
	from: string,
	fromRate: RateInput,
	to: string,
	toRate: RateInput,
): Decimal {
	const [num, den] = crossFractionDec(from, fromRate, to, toRate);
	return from === to ? new Dec(1) : num.div(den);
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

// ── Totals in a display currency ─────────────────────────────────────────────

/** Anything with an original amount and its stored USD value, in exact decimals. */
export interface MoneyItemDec {
	amount: Decimal;
	currency: string;
	/** Null for an unpriced item (no rate at all when loaded): it counts only in its own currency. */
	amountInUSD: Decimal | null;
	/**
	 * The rate (stored convention) the amount converts at, for an item whose
	 * USD value is not a stored figure (a share of a shared expense). Such an
	 * item converts straight from its amount and this rate in one division
	 * (D3), never through a cut USD quotient. Absent for a stored entry.
	 */
	rate?: Decimal | null;
	/**
	 * The home value booked when the entry was saved (expense.homeAmount,
	 * M2). It never moves with later rates, so it wins in its own currency.
	 */
	booked?: { currency: string; amount: Decimal } | null;
}

/** What missingRatesIn reads of an item. */
export interface PricedItem {
	currency: string;
	amountInUSD: Decimal | null;
	booked?: { currency: string } | null;
}

const isPriced = (item: PricedItem): boolean => item.amountInUSD !== null;

/** Whether the item is already in `currency`, as entered or as booked. */
const isIn = (item: PricedItem, currency: string): boolean =>
	item.currency === currency || item.booked?.currency === currency;

/** Whether `currency` converts: USD always, else a finite rate above zero. */
export const hasRate = (currency: string, rate: RateInput): boolean => {
	if (currency === USD) return true;
	const r = rate === null || rate === undefined ? null : dec(rate);
	return !!r?.isFinite() && r.gt(0);
};

/**
 * The currencies that keep `items` from totaling in `currency`: unpriced
 * items (no rate when loaded) in another currency, and `currency` itself
 * when something needs its missing rate. Empty when the total can be made.
 */
export function missingRatesIn(
	items: Iterable<PricedItem>,
	currency: string,
	rate: RateInput,
): string[] {
	const missing = new Set<string>();
	const rateless = !hasRate(currency, rate);
	for (const item of items) {
		if (isIn(item, currency)) continue;
		if (!isPriced(item)) missing.add(item.currency);
		if (rateless) missing.add(currency);
	}
	return [...missing].sort();
}

/**
 * Sum of `items` in `currency` under the totals rule (unrounded). Amounts
 * already in `currency` and stored USD values are each added first and
 * converted once: sum(x x r) = sum(x) x r exactly, and 10,000 items cost one
 * multiplication, not 10,000. Items that carry their own rate (shares) are
 * added per currency and rate, then converted from amount to `currency` in
 * one division each, so an exact tie stays a tie. Throws one MissingRateError
 * naming every currency that cannot convert, never counting a missing rate
 * as 1.
 */
export function sumInDec(
	items: Iterable<MoneyItemDec>,
	currency: string,
	rate: RateInput,
): Decimal {
	const list = [...items];
	const missing = missingRatesIn(list, currency, rate);
	if (missing[0]) throw new MissingRateError(missing[0], missing);
	let own = new Dec(0);
	let usd = new Dec(0);
	let converted = false;
	const byRate = new Map<
		string,
		{ currency: string; rate: Decimal; amount: Decimal }
	>();
	for (const item of list) {
		if (item.currency === currency) own = own.plus(item.amount);
		else if (item.booked?.currency === currency)
			own = own.plus(item.booked.amount);
		else if (item.rate && item.currency !== USD) {
			const key = `${item.currency} ${item.rate.toFixed()}`;
			const group = byRate.get(key) ?? {
				currency: item.currency,
				rate: item.rate,
				amount: new Dec(0),
			};
			group.amount = group.amount.plus(item.amount);
			byRate.set(key, group);
		} else if (item.amountInUSD) {
			usd = usd.plus(item.amountInUSD);
			converted = true;
		}
	}
	let total = converted ? own.plus(fromUSDDec(usd, currency, rate)) : own;
	for (const g of byRate.values())
		total = total.plus(
			convertDec(g.amount, g.currency, g.rate, currency, rate),
		);
	return total;
}
