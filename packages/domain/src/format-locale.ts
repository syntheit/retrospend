/**
 * A locale's number punctuation, read once from Intl and cached. The money
 * formatter and the input parser both build digits by hand from minor units
 * (no float), so they need the separators and group sizes rather than an
 * Intl.NumberFormat. Latin digits always: amounts stay tabular and parseable.
 */

export interface NumberSymbols {
	decimal: string;
	group: string;
	/** Digits in the rightmost group (3), 0 when the locale does not group. */
	primary: number;
	/** Digits in the groups further left (3, or 2 for en-IN lakhs). */
	secondary: number;
	/** Whether the locale puts a space between a currency symbol and digits. */
	symbolSpaced: boolean;
}

import { partsOf } from "./intl-parts";

const cache = new Map<string, NumberSymbols>();
const FALLBACK_LOCALE = "en-US";

/**
 * "en_US" (as Android and POSIX write it) becomes "en-US". An unknown or
 * malformed tag becomes en-US rather than whatever the host defaults to, so
 * the server, the browser and a phone format it the same way.
 */
function resolveLocale(locale: string): string {
	const tag = locale.trim().replace(/_/g, "-");
	try {
		return Intl.NumberFormat.supportedLocalesOf(tag)[0] ?? FALLBACK_LOCALE;
	} catch {
		return FALLBACK_LOCALE;
	}
}

export function numberSymbols(locale: string): NumberSymbols {
	const hit = cache.get(locale);
	if (hit) return hit;
	const symbols = readSymbols(resolveLocale(locale));
	cache.set(locale, symbols);
	return symbols;
}

function readSymbols(locale: string): NumberSymbols {
	// 123456789.5 has enough digits to show a secondary group size.
	const parts = partsOf(
		new Intl.NumberFormat(locale, { numberingSystem: "latn" }),
		123456789.5,
	);
	const groups = parts
		.filter((p) => p.type === "integer")
		.map((p) => p.value.length);
	const primary = groups.length > 1 ? (groups[groups.length - 1] ?? 0) : 0;
	const symbolSpaced = partsOf(
		new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
		1,
	).some((p) => p.type === "literal" && /\s/.test(p.value));
	return {
		decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
		group: parts.find((p) => p.type === "group")?.value ?? "",
		primary,
		secondary: groups.length > 2 ? (groups[groups.length - 2] ?? 0) : primary,
		symbolSpaced,
	};
}

/** The decimal separator a keypad shows for `locale` ("." en-US, "," es-AR). */
export function decimalSeparator(locale: string): string {
	return numberSymbols(locale).decimal;
}

/** The digit group separator for `locale` ("," en-US, "." es-AR, U+202F fr). */
export function groupSeparator(locale: string): string {
	return numberSymbols(locale).group;
}

/** "1234567" -> "1,234,567" (or "12,34,567" in en-IN) with the locale's groups. */
export function groupDigits(digits: string, symbols: NumberSymbols): string {
	const { primary, secondary, group } = symbols;
	if (primary === 0 || digits.length <= primary) return digits;
	let end = digits.length - primary;
	const chunks = [digits.slice(end)];
	while (end > 0) {
		const start = Math.max(0, end - secondary);
		chunks.unshift(digits.slice(start, end));
		end = start;
	}
	return chunks.join(group);
}

/** What a locale writes after a short compact number ("1M", "1 Mio.", "1 mil"). */
export interface CompactAffix {
	/** Text between the digits and the suffix (a no-break space or nothing). */
	gap: string;
	suffix: string;
}

const compactCache = new Map<string, CompactAffix | null>();

/**
 * The short compact suffix a locale uses for 10^exponent (3, 6, 9, 12), read
 * from Intl once. Only the words come from Intl; the digits are built from
 * minor units by the caller. Null when the locale does not abbreviate that
 * magnitude (German writes 1000, not "1 Tsd."), so the caller shows it whole.
 */
export function compactAffix(
	locale: string,
	exponent: number,
): CompactAffix | null {
	const key = `${locale}|${exponent}`;
	const hit = compactCache.get(key);
	if (hit !== undefined) return hit;
	const parts = partsOf(
		new Intl.NumberFormat(resolveLocale(locale), {
			notation: "compact",
			compactDisplay: "short",
			numberingSystem: "latn",
		}),
		10 ** exponent,
	);
	const at = parts.findIndex((p) => p.type === "compact");
	const affix =
		at < 0
			? null
			: {
					gap: parts
						.slice(0, at)
						.filter((p) => p.type === "literal")
						.map((p) => p.value)
						.join(""),
					suffix: parts[at]?.value ?? "",
				};
	compactCache.set(key, affix);
	return affix;
}

/** What a locale writes around a percent: "50%", "50 %". */
export interface PercentAffix {
	prefix: string;
	suffix: string;
}

const percentCache = new Map<string, PercentAffix>();

/** Tests only: forget what was read from Intl, after switching the parts path. */
export function clearLocaleCaches(): void {
	cache.clear();
	compactCache.clear();
	percentCache.clear();
}

export function percentAffix(locale: string): PercentAffix {
	const hit = percentCache.get(locale);
	if (hit) return hit;
	const parts = partsOf(
		new Intl.NumberFormat(resolveLocale(locale), {
			style: "percent",
			numberingSystem: "latn",
		}),
		0.5,
	);
	const at = parts.findIndex((p) => p.type === "integer");
	const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("");
	const affix = {
		prefix: text(parts.slice(0, Math.max(0, at))),
		suffix: text(parts.slice(at + 1)),
	};
	percentCache.set(locale, affix);
	return affix;
}
