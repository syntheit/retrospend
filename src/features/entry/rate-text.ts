/**
 * A typed exchange rate ("1,0834", "1.468", "0.0068") as a plain decimal
 * string for the server, read in the page locale. A rate is not money: it is
 * not held to the home currency's minor units (EUR 1.0834 in a USD home,
 * UYU 0.025, anything into JPY), so it gets its own reader, up to the 12
 * decimals the server books. Past 12 it rounds half-even in text (no float)
 * and the field shows the rounded rate, so what is booked is what is shown.
 */
import { decimalSeparator, groupSeparator } from "@retrospend/domain/parse";

const MAX_DECIMALS = 12;

/** "1.468" in es-AR is a thousands group only when every group after the first has 3 digits. */
function looksGrouped(text: string, mark: string): boolean {
	const parts = text.split(mark);
	return parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
}

/** The text with the locale's marks read: digits and one dot, or null. */
function canonicalOf(text: string, locale: string): string | null {
	// Spaces, no-break spaces and apostrophes (de-CH 1'468 or 1’468) only group.
	const raw = text.replace(/[\s  '’]/g, "");
	if (!/^[\d.,]+$/.test(raw)) return null;
	const dec = decimalSeparator(locale);
	const group = groupSeparator(locale);
	if (raw.includes(dec) && raw.includes(group)) {
		// Both marks: the locale says which is which.
		if (raw.lastIndexOf(group) > raw.indexOf(dec)) return null;
		return raw.split(group).join("").replace(dec, ".");
	}
	if (raw.includes(dec)) return raw.replace(dec, ".");
	if (group !== dec && raw.includes(group)) {
		return looksGrouped(raw, group)
			? raw.split(group).join("")
			: raw.replace(group, ".");
	}
	return raw;
}

/** `int.frac` at 12 decimals, half-even, on the digits themselves. */
function roundHalfEven(int: string, frac: string): [string, string] {
	const kept = BigInt(int + frac.slice(0, MAX_DECIMALS));
	const rest = frac.slice(MAX_DECIMALS);
	const head = rest.charAt(0);
	const above = head > "5" || (head === "5" && /[1-9]/.test(rest.slice(1)));
	const tie = head === "5" && !above;
	const up = above || (tie && kept % 2n === 1n);
	const digits = (kept + (up ? 1n : 0n))
		.toString()
		.padStart(MAX_DECIMALS + 1, "0");
	return [
		digits.slice(0, -MAX_DECIMALS),
		digits.slice(-MAX_DECIMALS).replace(/0+$/, ""),
	];
}

function readRate(
	text: string,
	locale: string,
): { rate: string; rounded: boolean } | null {
	const canonical = canonicalOf(text, locale);
	const m = canonical && /^(\d{1,13})(?:\.(\d+))?$/.exec(canonical);
	if (!m) return null;
	let int = m[1] ?? "";
	let frac = (m[2] ?? "").replace(/0+$/, "");
	const rounded = frac.length > MAX_DECIMALS;
	if (rounded) [int, frac] = roundHalfEven(int, frac);
	int = int.replace(/^0+(?=\d)/, "");
	if (/^0+$/.test(int) && frac === "") return null;
	return { rate: frac ? `${int}.${frac}` : int, rounded };
}

export function parseRateText(text: string, locale: string): string | null {
	return readRate(text, locale)?.rate ?? null;
}

/** What the rate field shows and books: a rate past 12 decimals shows rounded. */
export function readRateText(
	text: string,
	locale: string,
): { text: string; rate: string | null } {
	const read = readRate(text, locale);
	if (!read?.rounded) return { text, rate: read?.rate ?? null };
	return {
		text: read.rate.replace(".", decimalSeparator(locale)),
		rate: read.rate,
	};
}

/**
 * A rate held as a number (a table rate, or a form that still keeps floats) as
 * the plain decimal text the server takes: the digits of the number's exact
 * binary value, never an exponent, rounded to 12 decimals half-even like a
 * typed rate. Null when it is not a rate above zero.
 */
export function rateToText(rate: number): string | null {
	if (!Number.isFinite(rate) || rate <= 0) return null;
	// toFixed(100) is exact for every double a rate can be, so the rounding
	// sees the true digits.
	return parseRateText(rate.toFixed(100), "en-US");
}
