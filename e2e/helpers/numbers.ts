/**
 * Reads numbers back from rendered text, in the page's locale (en-US
 * "1,234.50", es-AR "1.234,50", fr "1 234,50"), for the figure audit and the
 * banned-output check. Values come back as integer strings plus a power of
 * ten, so nothing here rounds through floats.
 */

export interface ShownNumber {
	/** Explicit sign in the text before the digits, if any. */
	sign: "-" | "+" | null;
	/** Digits without separators, integer part then fraction. */
	digits: string;
	/** The shown value is digits × 10^exponent (fraction and compact suffix applied). */
	exponent: number;
	percent: boolean;
	/** The matched text, for messages. */
	raw: string;
}

const separatorCache = new Map<string, { group: string; decimal: string }>();

export function separatorsFor(locale: string): {
	group: string;
	decimal: string;
} {
	let found = separatorCache.get(locale);
	if (!found) {
		const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
		found = {
			group: parts.find((p) => p.type === "group")?.value ?? ",",
			decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
		};
		separatorCache.set(locale, found);
	}
	return found;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Compact suffixes the formatters use (en "1.2K", "3.4M"; es "12 mil", "1,2 M").
const COMPACT: Record<string, number> = { k: 3, K: 3, mil: 3, M: 6, B: 9 };

function numberPattern(locale: string): RegExp {
	const { group, decimal } = separatorsFor(locale);
	// A no-break space group also matches a plain space in hand-typed copy.
	const groups = /\s/.test(group)
		? `[${escapeRegExp(group)} ]`
		: escapeRegExp(group);
	return new RegExp(
		// Optional sign, currency prefix ("US$", "R$", "€", "ARS"), sign again.
		`([+\\-−]\\s?)?(?:(?:[A-Z]{0,3}\\p{Sc}|[A-Z]{3})\\s?)?([+\\-−]\\s?)?` +
			`(\\d+(?:${groups}\\d{3})*)(?:${escapeRegExp(decimal)}(\\d+))?` +
			`(?:\\s?(mil|[kKMB])(?![\\p{L}]))?(\\s?%)?`,
		"gu",
	);
}

function toShown(match: RegExpExecArray, locale: string): ShownNumber {
	const [raw, signBefore, signAfter, int = "", frac = "", suffix, pct] = match;
	const { group } = separatorsFor(locale);
	const intDigits = int.split(group).join("").replace(/ /g, "");
	const signText = (signBefore ?? signAfter ?? "").trim();
	return {
		sign: signText === "+" ? "+" : signText ? "-" : null,
		digits: `${intDigits}${frac}`.replace(/^0+(?=\d)/, ""),
		exponent: (suffix ? (COMPACT[suffix] ?? 0) : 0) - frac.length,
		percent: Boolean(pct),
		raw: raw.trim(),
	};
}

/** Every number in `text`, in order. */
export function findShownNumbers(text: string, locale: string): ShownNumber[] {
	const pattern = numberPattern(locale);
	const out: ShownNumber[] = [];
	for (const match of text.matchAll(pattern)) out.push(toShown(match, locale));
	return out;
}

/** The first number in `text`, or null. */
export function parseShownNumber(
	text: string,
	locale: string,
): ShownNumber | null {
	return findShownNumbers(text, locale)[0] ?? null;
}

/**
 * The shown number in units of 10^-decimals (minor units for money), and the
 * size of its last shown digit in those units: "ARS 1.235" with 2 decimals is
 * 123500, step 100.
 */
export function shownToUnits(
	shown: ShownNumber,
	decimals: number,
): { units: bigint; step: bigint } {
	const shift = shown.exponent + decimals;
	const digits = BigInt(shown.digits || "0");
	if (shift >= 0) {
		const step = 10n ** BigInt(shift);
		return { units: digits * step, step };
	}
	// More digits shown than the unit keeps: round half up to the unit.
	const div = 10n ** BigInt(-shift);
	return { units: (digits * 2n + div) / (div * 2n), step: 1n };
}

/** True when the shown value is above `limit` (sign ignored), compared exactly. */
export function shownAbove(shown: ShownNumber, limit: number): boolean {
	const digits = BigInt(shown.digits || "0");
	const bound = BigInt(limit);
	return shown.exponent >= 0
		? digits * 10n ** BigInt(shown.exponent) > bound
		: digits > bound * 10n ** BigInt(-shown.exponent);
}
