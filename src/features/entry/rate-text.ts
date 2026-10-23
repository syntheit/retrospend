/**
 * A typed exchange rate ("1,0834", "1.468", "0.0068") as a plain decimal
 * string for the server, read in the page locale. A rate is not money: it is
 * not held to the home currency's minor units (EUR 1.0834 in a USD home,
 * UYU 0.025, anything into JPY), so it gets its own reader, up to the 12
 * decimals the server books. The server does the math.
 */
import { decimalSeparator, groupSeparator } from "@retrospend/domain/parse";

const MAX_DECIMALS = 12;

/** "1.468" in es-AR is a thousands group only when every group after the first has 3 digits. */
function looksGrouped(text: string, mark: string): boolean {
	const parts = text.split(mark);
	return parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
}

export function parseRateText(text: string, locale: string): string | null {
	const raw = text.replace(/[\s  ']/g, "");
	if (!/^[\d.,]+$/.test(raw)) return null;
	const dec = decimalSeparator(locale);
	const group = groupSeparator(locale);
	let canonical: string;
	if (raw.includes(dec) && raw.includes(group)) {
		// Both marks: the locale says which is which.
		if (raw.lastIndexOf(group) > raw.indexOf(dec)) return null;
		canonical = raw.split(group).join("").replace(dec, ".");
	} else if (raw.includes(dec)) {
		canonical = raw.replace(dec, ".");
	} else if (group !== dec && raw.includes(group)) {
		canonical = looksGrouped(raw, group)
			? raw.split(group).join("")
			: raw.replace(group, ".");
	} else {
		canonical = raw;
	}
	const m = /^(\d{1,13})(?:\.(\d{1,12}))?$/.exec(canonical);
	if (!m) return null;
	const int = m[1]!.replace(/^0+(?=\d)/, "");
	const frac = (m[2] ?? "").replace(/0+$/, "");
	if (frac.length > MAX_DECIMALS) return null;
	if (/^0+$/.test(int) && frac === "") return null;
	return frac ? `${int}.${frac}` : int;
}
