/**
 * Valuation (02 §3.4, SPEC §5.3 and §5.12): what one row is worth in the
 * book currency H, in H minor units.
 *
 * - A row in H counts as entered.
 * - A row that recorded its own rate into H uses that rate (D43).
 * - Otherwise its USD value (the stored `amountInUSD`) is converted to H at
 *   the book rate type in force for the row's budget month
 *   (`BookPeriod.rateType`), on the row's date.
 * - Each row is rounded half-even to H minor units, then summed as integers.
 * - A missing rate never becomes 0 or 1: the row is left out and the figure
 *   is flagged incomplete with the rate it needed (C18).
 *
 * Rates use the stored convention of ~/lib/money: fiat in units per USD,
 * crypto in USD per coin. The loader supplies them through `usdRate`.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { isCrypto } from "~/lib/currency-format";
import { MissingRateError, USD } from "~/lib/money";
import type {
	DecimalLike,
	IsoDate,
	Minor,
	MissingRate,
	MonthKey,
} from "./types";
import { dec, sumMinor, toMinor } from "./units";

/** Start day and rate type in force from a budget month on (SPEC §5.1). */
export interface BookPeriod {
	fromMonth: MonthKey;
	startDay: number;
	rateType: string;
}

/** The stored-convention rate of `currency` of `rateType` on `date`, or null. */
export type UsdRateLookup = (
	currency: string,
	rateType: string,
	date: IsoDate,
) => DecimalLike | null;

export interface ValuationContext {
	bookCurrency: string;
	periods: readonly BookPeriod[];
	/** Rate type before the first period: the user's first favorite for H, else official. */
	defaultRateType: string;
	usdRate: UsdRateLookup;
}

export interface ValuationRow {
	id: string;
	amount: DecimalLike;
	currency: string;
	date: IsoDate;
	/** Budget month of the row; picks the BookPeriod rate type. */
	month: MonthKey;
	/**
	 * Rate the row recorded on the Add sheet: `perUnit` units of `to` per 1
	 * unit. Depends on 2A.2 (rate type per entry), which stores this rate on
	 * the row; its loader adopts or adapts this shape.
	 */
	ownRate?: { to: string; perUnit: DecimalLike } | null;
	amountInUSD?: DecimalLike | null;
}

export type ValuationSource = "BOOK_CURRENCY" | "OWN_RATE" | "BOOK_RATE";

export type Valuation =
	| { ok: true; minor: Minor; source: ValuationSource; rateType: string | null }
	| { ok: false; missing: MissingRate };

/** The BookPeriod in force for `month`: the latest one starting on or before it. */
export function periodForMonth(
	month: MonthKey,
	periods: readonly BookPeriod[],
): BookPeriod | null {
	let found: BookPeriod | null = null;
	for (const p of periods) {
		if (p.fromMonth <= month && (!found || p.fromMonth > found.fromMonth)) {
			found = p;
		}
	}
	return found;
}

export function rateTypeForMonth(
	month: MonthKey,
	ctx: Pick<ValuationContext, "periods" | "defaultRateType">,
): string {
	return periodForMonth(month, ctx.periods)?.rateType ?? ctx.defaultRateType;
}

/** A stored rate as a Decimal, or null when absent, zero or negative. */
function rateOf(
	currency: string,
	rateType: string,
	date: IsoDate,
	ctx: ValuationContext,
) {
	const raw = ctx.usdRate(currency, rateType, date);
	if (raw == null) return null;
	const r = dec(raw);
	return r.isFinite() && r.gt(0) ? r : null;
}

/** USD to `currency`: fiat rates are units per USD (multiply), crypto USD per coin (divide). */
function fromUsd(usd: Decimal, currency: string, rate: Decimal): Decimal {
	return isCrypto(currency) ? usd.div(rate) : usd.mul(rate);
}

/** `currency` to USD, the inverse of fromUsd. */
function toUsd(amount: Decimal, currency: string, rate: Decimal): Decimal {
	return isCrypto(currency) ? amount.mul(rate) : amount.div(rate);
}

/**
 * The row's USD value: its amount when in USD, else the stored amountInUSD.
 * A row with neither has no rate; guessing a rate type for its own currency
 * would be a guess on money.
 */
function usdValue(row: ValuationRow) {
	if (row.currency === USD) return dec(row.amount);
	return row.amountInUSD == null ? null : dec(row.amountInUSD);
}

function missing(
	row: ValuationRow,
	currency: string,
	rateType: string | null,
): Valuation {
	return {
		ok: false,
		missing: { currency, rateType, date: row.date, rowId: row.id },
	};
}

/** Book value of one row in H minor units (02 §3.4). */
export function valueRow(row: ValuationRow, ctx: ValuationContext): Valuation {
	const H = ctx.bookCurrency;
	if (row.currency === H) {
		return {
			ok: true,
			minor: toMinor(row.amount, H),
			source: "BOOK_CURRENCY",
			rateType: null,
		};
	}
	if (row.ownRate && row.ownRate.to === H) {
		const minor = toMinor(dec(row.amount).mul(dec(row.ownRate.perUnit)), H);
		return { ok: true, minor, source: "OWN_RATE", rateType: null };
	}
	const rateType = rateTypeForMonth(row.month, ctx);
	const usd = usdValue(row);
	if (!usd) return missing(row, row.currency, null);
	if (H === USD) {
		return { ok: true, minor: toMinor(usd, H), source: "BOOK_RATE", rateType };
	}
	const hRate = rateOf(H, rateType, row.date, ctx);
	if (!hRate) return missing(row, H, rateType);
	return {
		ok: true,
		minor: toMinor(fromUsd(usd, H, hRate), H),
		source: "BOOK_RATE",
		rateType,
	};
}

export interface ValuedSum {
	minor: Minor;
	/** True when at least one row was left out for a missing rate. */
	incomplete: boolean;
	missingRates: MissingRate[];
	values: Map<string, Minor>;
}

/** Sum of rows in H minor units; rows without a rate are left out and listed. */
export function sumRows(
	rows: Iterable<ValuationRow>,
	ctx: ValuationContext,
): ValuedSum {
	const values = new Map<string, Minor>();
	const missingRates: MissingRate[] = [];
	for (const row of rows) {
		const v = valueRow(row, ctx);
		if (v.ok) values.set(row.id, v.minor);
		else missingRates.push(v.missing);
	}
	return {
		minor: sumMinor(values.values()),
		incomplete: missingRates.length > 0,
		missingRates,
		values,
	};
}

/** When and how to convert an amount that is not a stored row. */
export interface ConvertOn {
	date: IsoDate;
	month: MonthKey;
	/** Rate type for the amount's own currency leg (not USD, not H): its default type. */
	foreignRateType?: string;
}

/** The USD value of `amount` at its currency's `rateType` rate on `date`. */
function usdAt(
	amount: DecimalLike,
	currency: string,
	rateType: string,
	date: IsoDate,
	ctx: ValuationContext,
) {
	const rate = rateOf(currency, rateType, date, ctx);
	return rate ? toUsd(dec(amount), currency, rate) : null;
}

/**
 * An amount in any currency at today's rates, for display and target sizing
 * (D25: "about USD 990 today"). The H leg uses the book rate type; a third
 * currency's leg uses `foreignRateType`, which the caller must name.
 */
export function convertToBook(
	amount: DecimalLike,
	currency: string,
	on: ConvertOn,
	ctx: ValuationContext,
): Valuation {
	const base = { id: "", amount, currency, date: on.date, month: on.month };
	if (currency === USD || currency === ctx.bookCurrency)
		return valueRow(base, ctx);
	const type = on.foreignRateType ?? null;
	const usd = type ? usdAt(amount, currency, type, on.date, ctx) : null;
	if (!usd) {
		return { ok: false, missing: { currency, rateType: type, date: on.date } };
	}
	return valueRow({ ...base, amountInUSD: usd }, ctx);
}

/** convertToBook that throws MissingRateError instead of returning a flag. */
export function convertToBookOrThrow(
	amount: DecimalLike,
	currency: string,
	on: ConvertOn,
	ctx: ValuationContext,
): Minor {
	const v = convertToBook(amount, currency, on, ctx);
	if (!v.ok) throw new MissingRateError(v.missing.currency);
	return v.minor;
}
