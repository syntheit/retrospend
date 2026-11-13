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
 * amountInUSD = toUSD(amount, currency, exchangeRate), rounded half to even
 * to cents. The exact math lives in money-dec.ts (the domain Decimal, 40
 * digits, half to even; Prisma's Decimal only at the database boundary, by
 * string). The number functions here wrap it for display and form drafts, and
 * this file is the declared display edge: everywhere else a number leaves
 * Decimal only through toFloat or roundedMajor (precise-decimal.ts,
 * money-minor.ts), and enters through fromFloat or columnText.
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
 * as entered, amounts booked in that currency when they were saved at their
 * booked value (expense.homeAmount, M2: it never drifts), and converts every
 * other amount from its stored amountInUSD at that currency's rate for the
 * period (sumInDec). The period's rate is the one for its last day, or today
 * while the period is still running (periodRateDate).
 */
import { currencyDecimals } from "./currency-decimals";
import { isCrypto } from "./currency-format";
import {
	computeAmountInUSDDec,
	convertDec,
	crossRateDec,
	fromUSDDec,
	MissingRateError,
	rateFromUsdPerUnitDec,
	roundMoneyDec,
	toUSDDec,
	USD,
	usdPerUnitDec,
} from "./money-dec";
import { roundedMinor } from "./money-minor";
import { dec, fromFloat } from "./precise-decimal";

export { currencyDecimals, MissingRateError, USD };

export function isValidRate(rate: unknown): rate is number {
	return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

// ── Conversion ───────────────────────────────────────────────────────────────
// The number functions below wrap money-dec.ts, the one implementation. They
// are for display and form drafts only; stored figures and totals use
// money-dec. An amount enters through fromFloat, the one float-noise trim; a
// rate as its shortest decimal, exact for the 6-decimal column.

/** USD value of one unit of `currency`, given its stored rate. */
export function usdPerUnit(
	currency: string,
	rate: number | null | undefined,
): number {
	return Number(usdPerUnitDec(currency, rate));
}

/** Stored rate for `currency` given the USD value of one unit. */
export function rateFromUsdPerUnit(currency: string, usdValue: number): number {
	return Number(rateFromUsdPerUnitDec(currency, usdValue));
}

/** Converts an amount to USD (unrounded). */
export function toUSD(
	amount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	return Number(toUSDDec(fromFloat(amount), currency, rate));
}

/** Converts a USD amount to `currency` (unrounded). */
export function fromUSD(
	usdAmount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	return Number(fromUSDDec(fromFloat(usdAmount), currency, rate));
}

/** Converts between any two currencies through USD (unrounded). */
export function convertAmount(
	amount: number,
	from: string,
	fromRate: number | null | undefined,
	to: string,
	toRate: number | null | undefined,
): number {
	return Number(convertDec(fromFloat(amount), from, fromRate, to, toRate));
}

/**
 * convertAmount for display code that has a "no rate" state: null instead
 * of throwing when a needed rate is missing.
 */
export function tryConvertAmount(
	amount: number,
	from: string,
	fromRate: number | null | undefined,
	to: string,
	toRate: number | null | undefined,
): number | null {
	try {
		return convertAmount(amount, from, fromRate, to, toRate);
	} catch (error) {
		if (error instanceof MissingRateError) return null;
		throw error;
	}
}

/** Units of `to` per one unit of `from`. */
export function crossRate(
	from: string,
	fromRate: number | null | undefined,
	to: string,
	toRate: number | null | undefined,
): number {
	return Number(crossRateDec(from, fromRate, to, toRate));
}

/** amountInUSD as stored on expenses: converted and rounded to cents, half to even. */
export function computeAmountInUSD(
	amount: number,
	currency: string,
	rate: number | null | undefined,
): number {
	return Number(computeAmountInUSDDec(fromFloat(amount), currency, rate));
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
// Totals are exact: money-dec sumInDec and missingRatesIn.

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
	const homePerForeign = crossRateDec(foreign, foreignRate, home, homeRate);
	if (homePerForeign.gte(1)) {
		return { base: foreign, quote: home, value: Number(homePerForeign) };
	}
	return {
		base: home,
		quote: foreign,
		value: Number(dec(1).div(homePerForeign)),
	};
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
	if (!isValidRate(quote.value)) throw new MissingRateError(foreign);
	const value = dec(quote.value);
	const homeUsd = usdPerUnitDec(home, homeRate);
	const foreignUsd =
		quote.base === foreign ? value.mul(homeUsd) : homeUsd.div(value);
	return Number(rateFromUsdPerUnitDec(foreign, foreignUsd));
}

// ── Decimals and rounding (number edge) ──────────────────────────────────────

/** Amount in integer minor units (cents, satoshis, fils), half to even. */
export function toMinorUnits(amount: number, currency: string): number {
	return roundedMinor(fromFloat(amount), currency);
}

export function fromMinorUnits(units: number, currency: string): number {
	return Number(dec(units).div(10 ** currencyDecimals(currency)));
}

/** An amount at its currency's precision, half to even. */
export function roundMoney(amount: number, currency: string): number {
	return Number(roundMoneyDec(fromFloat(amount), currency));
}

/**
 * Plain decimal string for an amount at its currency's precision, for
 * inputs and payment links: ISO minor units for fiat ("1200" JPY, "12.50"
 * USD, "1.250" KWD), up to 8 decimals for crypto with trailing zeros
 * dropped ("0.004" ETH). No grouping, no symbol.
 */
export function toAmountString(amount: number, currency: string): string {
	const decimals = currencyDecimals(currency);
	const fixed = roundMoneyDec(fromFloat(amount), currency).toFixed(decimals);
	if (!isCrypto(currency) || decimals === 0) return fixed;
	return fixed.replace(/\.?0+$/, "");
}

export function roundUSD(amount: number): number {
	return roundMoney(amount, USD);
}

// ── Rate selection ───────────────────────────────────────────────────────────

/** Rows the server reads per side of a date (src/server/exchange-rates.ts fetchRows). */
export const RATE_ROWS_PER_SIDE = 20;

/**
 * The rows the server's lookup sees for `date`, from all of one currency's
 * rows: the newest RATE_ROWS_PER_SIDE on or before the date (newest first,
 * ties by type), and only when none exist on or before it, the earliest
 * RATE_ROWS_PER_SIDE after it. A type whose newest row is older than that
 * window is invisible to the pick, so a device must see the same window or
 * it prices at a different rate type than the server.
 */
export function rateWindow(rows: readonly RateRow[], date: Date): RateRow[] {
	const at = date.getTime();
	const byType = (a: RateRow, b: RateRow) =>
		a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
	const before = rows
		.filter((r) => r.date.getTime() <= at)
		.sort((a, b) => b.date.getTime() - a.date.getTime() || byType(a, b));
	if (before.length > 0) return before.slice(0, RATE_ROWS_PER_SIDE);
	return rows
		.filter((r) => r.date.getTime() > at)
		.sort((a, b) => a.date.getTime() - b.date.getTime() || byType(a, b))
		.slice(0, RATE_ROWS_PER_SIDE);
}

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
			(onOrBefore && current.onOrBefore && time > current.date.getTime()) ||
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

// ── Rate lookups over rows held in memory ───────────────────────────────────

/** A stored rate row with its currency, the rate as a number or exact text. */
export interface StoredRateRow {
	currency: string;
	type: string;
	rate: number | string | { toString(): string };
	date: Date;
}

/**
 * The rows of `currencies` (USD never has any), grouped per currency and with
 * the rate as a number: what the server reads with one query and a device
 * filters from its store, the input of rateLookup.
 */
export function rateRowsByCurrency(
	rows: Iterable<StoredRateRow>,
	currencies: Iterable<string>,
): Record<string, RateRow[]> {
	const wanted = new Set([...currencies].filter((c) => c !== USD));
	const out: Record<string, RateRow[]> = {};
	for (const r of rows) {
		if (!wanted.has(r.currency)) continue;
		const list = out[r.currency] ?? [];
		list.push({
			type: r.type,
			rate: typeof r.rate === "number" ? r.rate : Number(r.rate.toString()),
			date: r.date,
		});
		out[r.currency] = list;
	}
	return out;
}

/**
 * A resolver over the rows of rateRowsByCurrency: the best rate for a currency
 * on a date from all its rows (no window, as a batch lookup of the server
 * reads them). USD is 1; null only for a currency without any rate.
 */
export function rateLookup(
	rows: Readonly<Record<string, readonly RateRow[]>>,
): (
	currency: string,
	date: Date,
	preferredType?: string | null,
) => PickedRate | null {
	return (currency, date, preferredType) =>
		currency === USD
			? { rate: 1, type: "official", date, onOrBefore: true }
			: pickBestRate(rows[currency] ?? [], { date, preferredType });
}
