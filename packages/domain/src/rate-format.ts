/**
 * How a rate reads on screen, on every platform: one pair, one direction, a
 * number that is at least 1. "1 USD = 1,545.20 ARS", "1 USD = 5.40 BRL",
 * "1 EUR = 1.0834 USD", "1 BTC = 64,545.12 USD". Never "1 ARS = 0.00 USD".
 *
 * A rate comes in as units of `to` per one unit of `from` (the cross rate the
 * server books, e.g. `expense.homeRate`), as a plain decimal string or a
 * number. This only words it: nothing here is booked, and a missing, zero or
 * unreadable rate gives null (a missing rate is never 1, so the caller says
 * "No rate" instead). A rate type's name always travels with the number:
 * `formatRateWithType("Blue", ...)` is "Blue · 1 USD = 1,545.20 ARS".
 */
import { groupDigits, numberSymbols } from "./format-locale";

export type RateInput = number | string | null | undefined;

/** A rate as people read it: 1 `base` = `value` `quote`, with `value` >= 1. */
export interface OrientedRate {
	base: string;
	quote: string;
	value: number;
}

function readable(rate: RateInput): number | null {
	if (rate === null || rate === undefined || rate === "") return null;
	const n = typeof rate === "number" ? rate : Number(rate);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The pair in the direction whose number is at least 1. A rate that is
 * exactly 1 keeps `from` as the base. Null when there is no usable rate.
 */
export function orientRate(
	from: string,
	to: string,
	perFrom: RateInput,
): OrientedRate | null {
	const n = readable(perFrom);
	if (n === null) return null;
	const a = from.toUpperCase();
	const b = to.toUpperCase();
	return n >= 1
		? { base: a, quote: b, value: n }
		: { base: b, quote: a, value: 1 / n };
}

/** The oriented number in the locale's marks: 2 decimals from 100 up, 2 to 4 below. */
export function formatRateValue(value: number, locale = "en-US"): string {
	const max = value >= 100 ? 2 : 4;
	const fixed = new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: max,
		useGrouping: false,
	}).format(value);
	const [int = "0", frac = ""] = fixed.split(".");
	const symbols = numberSymbols(locale);
	return `${groupDigits(int, symbols)}${symbols.decimal}${frac}`;
}

/** "1 USD = 1,545.20 ARS" for `perFrom` units of `to` per 1 `from`; null without a rate. */
export function formatRate(
	from: string,
	to: string,
	perFrom: RateInput,
	locale = "en-US",
): string | null {
	const r = orientRate(from, to, perFrom);
	if (!r) return null;
	return `1 ${r.base} = ${formatRateValue(r.value, locale)} ${r.quote}`;
}

/** "Blue · 1 USD = 1,545.20 ARS": the type never travels without its number. Null without a rate. */
export function formatRateWithType(
	typeName: string,
	from: string,
	to: string,
	perFrom: RateInput,
	locale = "en-US",
): string | null {
	const rate = formatRate(from, to, perFrom, locale);
	if (!rate) return null;
	return typeName ? `${typeName} · ${rate}` : rate;
}
