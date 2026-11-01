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
import { decimalSeparator, groupDigits, numberSymbols } from "./format-locale";
import { parseRateText, rateToText } from "./rate-text";

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

/**
 * The same pair read with `base` as the single unit, whatever the number
 * turns out to be: a row of rates for one pair (Official, Blue, MEP) shares
 * one direction, taken from the first. Null when `base` is not in the pair
 * or there is no usable rate.
 */
export function orientRateAs(
	base: string,
	from: string,
	to: string,
	perFrom: RateInput,
): OrientedRate | null {
	const n = readable(perFrom);
	if (n === null) return null;
	const a = from.toUpperCase();
	const b = to.toUpperCase();
	const want = base.toUpperCase();
	if (want === a) return { base: a, quote: b, value: n };
	if (want === b) return { base: b, quote: a, value: 1 / n };
	return null;
}

/**
 * The number in the locale's marks: 2 decimals from 100 up, 2 to 4 from 1
 * up. Below 1 (only when a caller pins the direction) up to 8, so a weak
 * currency's rate is never "0.00".
 */
export function formatRateValue(value: number, locale = "en-US"): string {
	const max = value >= 100 ? 2 : value >= 1 ? 4 : 8;
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

// ── Typing a rate the way it reads ───────────────────────────────────────────

/** The way a pair reads: 1 `base` = N `quote`. `flipped` when `base` is the pair's `to`. */
export interface RateDirection {
	base: string;
	quote: string;
	flipped: boolean;
}

/**
 * The direction a custom rate is typed in for the pair `from` to `to`: the
 * direction the pair's known rate reads at least 1 in (`reference` is any
 * rate for the pair, units of `to` per one `from`: a table rate, or the one
 * a saved entry was booked at). Without a reference the pair reads in its
 * stored direction. The same pair always gives the same direction, so what
 * is typed, shown and prefilled agree.
 */
export function rateDirection(
	from: string,
	to: string,
	reference: RateInput,
): RateDirection {
	const o = orientRate(from, to, reference);
	const a = from.toUpperCase();
	const b = to.toUpperCase();
	return o && o.base === b
		? { base: b, quote: a, flipped: true }
		: { base: a, quote: b, flipped: false };
}

/** 1 / `canonical` as a decimal at `places`, half-even; null when the result is not above zero. */
function invertDecimal(canonical: string, places: number): string | null {
	const [int = "", frac = ""] = canonical.split(".");
	const n = BigInt(int + frac);
	if (n === 0n) return null;
	const num = 10n ** BigInt(frac.length + places);
	let q = num / n;
	const twice = (num % n) * 2n;
	if (twice > n || (twice === n && q % 2n === 1n)) q += 1n;
	if (q === 0n) return null;
	const digits = q.toString().padStart(places + 1, "0");
	const head = digits.slice(0, digits.length - places);
	const tail = digits.slice(digits.length - places).replace(/0+$/, "");
	return tail ? `${head}.${tail}` : head;
}

/**
 * What the person typed (the number beside "1 BASE =") as the stored rate:
 * units of `to` per one `from`, a plain decimal of at most 12 places. Null
 * for empty, zero, negative or unreadable text, or a number too large to
 * invert to a rate. `flipped` comes from {@link rateDirection}.
 */
export function typedRateToStored(
	text: string,
	flipped: boolean,
	locale: string,
): string | null {
	const typed = parseRateText(text, locale);
	if (typed === null) return null;
	return flipped ? invertDecimal(typed, 12) : typed;
}

/**
 * A stored rate as the text to put in the field, in the typed direction and
 * the locale's decimal mark, with no grouping. A flipped rate shows 4
 * decimals (2 for a very weak currency), trailing zeros dropped. Empty
 * without a rate.
 */
export function storedRateToTyped(
	stored: RateInput,
	flipped: boolean,
	locale = "en-US",
): string {
	const canonical =
		typeof stored === "number"
			? rateToText(stored)
			: typeof stored === "string"
				? parseRateText(stored, "en-US")
				: null;
	if (canonical === null) return "";
	const typed = flipped
		? invertDecimal(canonical, Number(canonical) < 0.001 ? 2 : 4)
		: canonical;
	if (typed === null) return "";
	return typed.replace(".", decimalSeparator(locale));
}
