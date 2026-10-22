/**
 * Money: the single source of truth for currency conversion, rate selection
 * and rounding. Pure and isomorphic, so the expense form and the server use
 * the exact same math.
 *
 * RATE CONVENTION (ExchangeRate.rate, Expense.exchangeRate,
 * SharedTransaction.exchangeRate, CSV import/export):
 * - USD: always 1.
 * - Fiat: units of the currency per 1 USD. ARS 1560 means 1 USD = 1560 ARS.
 * - Crypto: USD per 1 coin. BTC 64545 means 1 BTC = 64545 USD.
 * Crypto vs fiat is decided by the currency code (isCrypto), never by the
 * rate "type": ARS has a "crypto" rate type that is still ARS per USD.
 *
 * amountInUSD = toUSD(amount, currency, exchangeRate), rounded to cents.
 * Converting between two non-USD currencies always goes through USD. A rate
 * shown to the user ("1 EUR = 1775 ARS") is a display quote built with
 * quoteRate(); it is never stored.
 *
 * A missing rate never becomes 1. Lookups fall back to the nearest rate on
 * the other side of the requested date; when a currency has no rate at all,
 * the math functions throw MissingRateError.
 *
 * TOTALS RULE (dashboard, budget page, stats, runway): a total shown in some
 * currency (home or budget currency) counts amounts already in that currency
 * as entered, and converts every other amount from its stored amountInUSD at
 * that currency's rate for the period (sumIn). The period's rate is the one
 * for its last day, or today while the period is still running
 * (periodRateDate).
 */
import { getDecimalDigits, isCrypto } from "./currency-format";

export const USD = "USD";

export class MissingRateError extends Error {
	constructor(public readonly currency: string) {
		super(`No exchange rate available for ${currency}`);
		this.name = "MissingRateError";
	}
}

export function isValidRate(rate: unknown): rate is number {
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function assertRate(currency: string, rate: number | null | undefined): number {
	if (!isValidRate(rate)) throw new MissingRateError(currency);
	return rate;
}

// ── Conversion ───────────────────────────────────────────────────────────────

/** USD value of one unit of `currency`, given its stored rate. */
export function usdPerUnit(
	currency: string,
	rate: number | null | undefined,
): number {
	if (currency === USD) return 1;
	const r = assertRate(currency, rate);
	return isCrypto(currency) ? r : 1 / r;
}

/** Stored rate for `currency` given the USD value of one unit. */
export function rateFromUsdPerUnit(currency: string, usdValue: number): number {
	if (currency === USD) return 1;
	const v = assertRate(currency, usdValue);
	return isCrypto(currency) ? v : 1 / v;
}

/** Converts an amount to USD (unrounded). */
export function toUSD(
	amount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	if (currency === USD) return amount;
	return amount * usdPerUnit(currency, rate);
}

/** Converts a USD amount to `currency` (unrounded). */
export function fromUSD(
	usdAmount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	if (currency === USD) return usdAmount;
	return usdAmount / usdPerUnit(currency, rate);
}

/** Converts between any two currencies through USD (unrounded). */
export function convertAmount(
	amount: number,
	from: string,
	fromRate: number | null | undefined,
	to: string,
	toRate: number | null | undefined,
): number {
	if (from === to) return amount;
	return fromUSD(toUSD(amount, from, fromRate), to, toRate);
}

/** Units of `to` per one unit of `from`. */
export function crossRate(
	from: string,
	fromRate: number | null | undefined,
	to: string,
	toRate: number | null | undefined,
): number {
	return convertAmount(1, from, fromRate, to, toRate);
}

/** amountInUSD as stored on expenses: converted and rounded to cents. */
export function computeAmountInUSD(
	amount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	return roundUSD(toUSD(amount, currency, rate));
}

/**
 * What an expense form shows and sends for an amount: amountInUSD (stored)
 * and the same amount in the home currency (display only). Either is
 * undefined while a needed rate is still unknown.
 */
export function expenseAmounts(args: {
	amount: number | null | undefined;
	currency: string;
	rate: number | null | undefined;
	homeCurrency: string;
	homeRate: number | null | undefined;
}): { amountInUSD?: number; homeAmount?: number } {
	const { amount, currency, rate, homeCurrency, homeRate } = args;
	if (typeof amount !== "number" || !Number.isFinite(amount)) return {};
	const hasRate = currency === USD || isValidRate(rate);
	const hasHomeRate = homeCurrency === USD || isValidRate(homeRate);
	const amountInUSD = hasRate
		? computeAmountInUSD(amount, currency, rate)
		: undefined;
	let homeAmount: number | undefined;
	if (currency === homeCurrency) homeAmount = amount;
	else if (hasRate && hasHomeRate)
		homeAmount = convertAmount(amount, currency, rate, homeCurrency, homeRate);
	return { amountInUSD, homeAmount };
}

// ── Totals in a display currency ─────────────────────────────────────────────

/** Anything with an original amount and its stored USD value. */
export interface MoneyItem {
	amount: number;
	currency: string;
	amountInUSD: number;
}

/**
 * One item in `currency` under the totals rule: its own amount when it is
 * already in `currency`, else its USD value converted at `rate`.
 */
export function amountIn(
	item: MoneyItem,
	currency: string,
	rate: number | null | undefined,
): number {
	if (item.currency === currency) return item.amount;
	return fromUSD(item.amountInUSD, currency, rate);
}

/** Sum of `items` in `currency` under the totals rule (unrounded). */
export function sumIn(
	items: Iterable<MoneyItem>,
	currency: string,
	rate: number | null | undefined,
): number {
	let total = 0;
	for (const item of items) total += amountIn(item, currency, rate);
	return total;
}

/** The date whose rate converts a period's totals: its end, or now if sooner. */
export function periodRateDate(periodEnd: Date, now: Date = new Date()): Date {
	return periodEnd.getTime() < now.getTime() ? periodEnd : now;
}

// ── Display quotes ───────────────────────────────────────────────────────────

/** A rate as people read it: 1 `base` = `value` `quote`. */
export interface RateQuote {
	base: string;
	quote: string;
	value: number;
}

/**
 * Human-readable rate between a foreign currency and the home currency,
 * oriented so the number is at least 1 (1 USD = 1560 ARS, 1 EUR = 1.14 USD,
 * 1 BTC = 64545 USD).
 */
export function quoteRate(
	foreign: string,
	foreignRate: number | null | undefined,
	home: string,
	homeRate: number | null | undefined,
): RateQuote {
	const homePerForeign = crossRate(foreign, foreignRate, home, homeRate);
	if (homePerForeign >= 1) {
		return { base: foreign, quote: home, value: homePerForeign };
	}
	return { base: home, quote: foreign, value: 1 / homePerForeign };
}

/**
 * Inverse of quoteRate: the stored rate for `foreign` implied by a quote
 * between `foreign` and `home` in either orientation.
 */
export function rateFromQuote(
	quote: RateQuote,
	foreign: string,
	home: string,
	homeRate: number | null | undefined,
): number {
	const value = assertRate(foreign, quote.value);
	const homeUsd = usdPerUnit(home, homeRate);
	const foreignUsd =
		quote.base === foreign ? value * homeUsd : homeUsd / value;
	return rateFromUsdPerUnit(foreign, foreignUsd);
}

// ── Decimals and rounding ────────────────────────────────────────────────────

// ISO 4217 minor units that differ from the default of 2.
const ZERO_DECIMAL = new Set([
	"BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
	"UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set([
	"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

/**
 * Decimal places money in `currency` is kept to. ISO 4217 for fiat, 8 for
 * crypto (2 for stablecoins). Display formatting may show fewer.
 */
export function currencyDecimals(currency: string): number {
	const code = currency.toUpperCase();
	if (isCrypto(code)) return getDecimalDigits(code, false);
	if (ZERO_DECIMAL.has(code)) return 0;
	if (THREE_DECIMAL.has(code)) return 3;
	return 2;
}

/** Amount in integer minor units (cents, satoshis, fils). */
export function toMinorUnits(amount: number, currency: string): number {
	const factor = 10 ** currencyDecimals(currency);
	// toPrecision trims float noise such as 1.005 * 100 = 100.49999999999999.
	return Math.round(Number((amount * factor).toPrecision(15)));
}

export function fromMinorUnits(units: number, currency: string): number {
	const decimals = currencyDecimals(currency);
	return Number((units / 10 ** decimals).toFixed(decimals));
}

export function roundMoney(amount: number, currency: string): number {
	return fromMinorUnits(toMinorUnits(amount, currency), currency);
}

/**
 * Plain decimal string for an amount at its currency's precision, for
 * inputs and payment links: ISO minor units for fiat ("1200" JPY, "12.50"
 * USD, "1.250" KWD), up to 8 decimals for crypto with trailing zeros
 * dropped ("0.004" ETH). No grouping, no symbol.
 */
export function toAmountString(amount: number, currency: string): string {
	const decimals = currencyDecimals(currency);
	const fixed = roundMoney(amount, currency).toFixed(decimals);
	if (!isCrypto(currency) || decimals === 0) return fixed;
	return fixed.replace(/\.?0+$/, "");
}

export function roundUSD(amount: number): number {
	return roundMoney(amount, USD);
}

// ── Rate selection ───────────────────────────────────────────────────────────

/** Rate types in order of preference when the caller has no preference. */
export const RATE_TYPE_PRIORITY = ["blue", "official", "crypto"] as const;

export interface RateRow {
	type: string;
	rate: number;
	date: Date;
}

export interface PickedRate {
	rate: number;
	type: string;
	date: Date;
	/** False when no rate existed on or before the date and a later one was used. */
	onOrBefore: boolean;
}

function typeRank(type: string): number {
	const idx = (RATE_TYPE_PRIORITY as readonly string[]).indexOf(type);
	return idx === -1 ? RATE_TYPE_PRIORITY.length : idx;
}

/**
 * Picks the rate to use for a date from a currency's rate rows.
 *
 * For each type, the latest rate on or before `date` wins; if there is none,
 * the earliest rate after it (nearest available). A `preferredType` that has
 * rows is used as is; otherwise types are ranked blue > official > crypto >
 * the rest, preferring types that have a rate on or before the date.
 */
export function pickBestRate(
	rows: readonly RateRow[],
	options: { date?: Date; preferredType?: string | null } = {},
): PickedRate | null {
	const at = options.date?.getTime() ?? Number.POSITIVE_INFINITY;
	const byType = new Map<string, PickedRate>();

	for (const row of rows) {
		if (!isValidRate(row.rate)) continue;
		const time = row.date.getTime();
		const onOrBefore = time <= at;
		const current = byType.get(row.type);
		const better =
			!current ||
			(onOrBefore && !current.onOrBefore) ||
			(onOrBefore &&
				current.onOrBefore &&
				time > current.date.getTime()) ||
			(!onOrBefore && !current.onOrBefore && time < current.date.getTime());
		if (better) {
			byType.set(row.type, {
				rate: row.rate,
				type: row.type,
				date: row.date,
				onOrBefore,
			});
		}
	}

	if (byType.size === 0) return null;

	if (options.preferredType) {
		const preferred = byType.get(options.preferredType);
		if (preferred) return preferred;
	}

	const ranked = [...byType.values()].sort(
		(a, b) =>
			Number(b.onOrBefore) - Number(a.onOrBefore) ||
			typeRank(a.type) - typeRank(b.type) ||
			a.type.localeCompare(b.type),
	);
	return ranked[0] ?? null;
}
