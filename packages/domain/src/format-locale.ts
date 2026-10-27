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
 * The account's number format setting: null follows the language. Each
 * choice names the group and the decimal separator, in that order. It keeps
 * the language's pattern (where the sign and the symbol go, how digits
 * group) and swaps only these two marks.
 */
export const NUMBER_FORMATS = [
	"comma_dot",
	"dot_comma",
	"space_comma",
] as const;
export type NumberFormatChoice = (typeof NUMBER_FORMATS)[number];

/** What each choice writes. U+202F is the narrow no-break space French uses. */
const SEPARATORS: Record<
	NumberFormatChoice,
	{ group: string; decimal: string }
> = {
	comma_dot: { group: ",", decimal: "." },
	dot_comma: { group: ".", decimal: "," },
	space_comma: { group: "\u202f", decimal: "," },
};

export function numberFormatSeparators(choice: NumberFormatChoice): {
	group: string;
	decimal: string;
} {
	return SEPARATORS[choice];
}

/**
 * The choice rides on the locale tag as a BCP 47 private-use suffix
 * ("es-AR-x-nf-cd"), so every function that already takes a `locale` (the
 * formatter, the typing parser, the draft helpers) honors it with no new
 * parameter, and a client sets it in one place. Intl never sees the suffix:
 * baseLocale strips it first.
 */
const TAG_CODES: Record<NumberFormatChoice, string> = {
	comma_dot: "cd",
	dot_comma: "dc",
	space_comma: "sc",
};
const TAG_SUFFIX = /-x-nf-(cd|dc|sc)$/i;

/** `locale` with the number format choice attached; null follows the language. */
export function withNumberFormat(
	locale: string,
	choice: NumberFormatChoice | null | undefined,
): string {
	const base = baseLocale(locale);
	return choice ? `${base}-x-nf-${TAG_CODES[choice]}` : base;
}

/** The locale without any number format suffix: what Intl may be given. */
export function baseLocale(locale: string): string {
	return locale.trim().replace(TAG_SUFFIX, "");
}

/** The number format choice a locale tag carries, or null. */
export function numberFormatOf(locale: string): NumberFormatChoice | null {
	const code = TAG_SUFFIX.exec(locale.trim())?.[1]?.toLowerCase();
	return NUMBER_FORMATS.find((choice) => TAG_CODES[choice] === code) ?? null;
}

/**
 * "en_US" (as Android and POSIX write it) becomes "en-US". An unknown or
 * malformed tag becomes en-US rather than whatever the host defaults to, so
 * the server, the browser and a phone format it the same way.
 */
function resolveLocale(locale: string): string {
	const tag = baseLocale(locale).replace(/_/g, "-");
	try {
		return Intl.NumberFormat.supportedLocalesOf(tag)[0] ?? FALLBACK_LOCALE;
	} catch {
		return FALLBACK_LOCALE;
	}
}

export function numberSymbols(locale: string): NumberSymbols {
	const hit = cache.get(locale);
	if (hit) return hit;
	const symbols = withChoice(
		readSymbols(resolveLocale(locale)),
		numberFormatOf(locale),
	);
	cache.set(locale, symbols);
	return symbols;
}

/**
 * The language's symbols with the account's separators over them. A set
 * format always groups in threes: a language that does not group (or only
 * from five digits) still gives "1.920,30", and en-IN's lakh groups give
 * "123 456,78" rather than "1 23 456,78".
 */
function withChoice(
	symbols: NumberSymbols,
	choice: NumberFormatChoice | null,
): NumberSymbols {
	if (!choice) return symbols;
	return { ...symbols, ...SEPARATORS[choice], primary: 3, secondary: 3 };
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
