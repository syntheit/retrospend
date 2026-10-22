/**
 * Percent from basis points of a percent: the server sends shares and
 * changes as integer hundredths of a percent (1834 is 18.34%), and this is
 * the one place they become text. Digits are built from the integer by
 * hand, rounded half to even, so no float ever touches the value.
 * Golden cases: vectors/display-format.vectors.json.
 */
import { groupDigits, numberSymbols, percentAffix } from "./format-locale";

export interface FormatPercentOptions {
	locale: string;
	/** Fraction digits to show, 0 to 2. Default 1. */
	digits?: 0 | 1 | 2;
	/** Trailing zeros of the fraction go ("18%" not "18.0%"). Default true. */
	trim?: boolean;
	/** auto: minus for negatives. exceptZero: plus for positives too. */
	sign?: "auto" | "exceptZero";
}

/** |value| rounded half to even to drop its last `drop` digits. */
function roundHalfEven(abs: number, drop: number): number {
	if (drop <= 0) return abs;
	const unit = 10 ** drop;
	const rest = abs % unit;
	const kept = (abs - rest) / unit;
	const twice = rest * 2;
	return twice > unit || (twice === unit && kept % 2 === 1) ? kept + 1 : kept;
}

/** "18.3%", "-2.2%", "+0.6%", "83 %" (fr), from hundredths of a percent. */
export function formatPercent(
	basis: number,
	options: FormatPercentOptions,
): string {
	if (!Number.isSafeInteger(basis))
		throw new RangeError(`Percent basis must be a safe integer, got ${basis}`);
	const { locale, digits = 1, trim = true, sign = "auto" } = options;
	const rounded = roundHalfEven(Math.abs(basis), 2 - digits);
	const text = String(rounded).padStart(digits + 1, "0");
	const cut = text.length - digits;
	let fraction = text.slice(cut);
	if (trim) fraction = fraction.replace(/0+$/, "");
	const symbols = numberSymbols(locale);
	const number =
		groupDigits(text.slice(0, cut), symbols) +
		(fraction ? symbols.decimal + fraction : "");
	const signText =
		rounded === 0 ? "" : basis < 0 ? "-" : sign === "exceptZero" ? "+" : "";
	const { prefix, suffix } = percentAffix(locale);
	return signText + prefix + number + suffix;
}
