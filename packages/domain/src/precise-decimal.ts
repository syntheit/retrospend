/**
 * Exact decimal arithmetic for money math that runs on the server and on
 * devices. One configured class, so no module picks its own precision or
 * rounding. Prisma's Decimal is the same library, so values cross by string.
 *
 * Precision 40 holds amount (Decimal 19,8) x rate (Decimal 18,6), which is 37
 * significant digits, with no loss. The library default of 20 digits would
 * round a long sum of Decimal(19,8) values that Postgres keeps exactly.
 * Rounding is half-even (IMPLEMENTATION section 2.2).
 */
import { Decimal } from "decimal.js";

export const Dec = Decimal.clone({
	precision: 40,
	rounding: Decimal.ROUND_HALF_EVEN,
});

export type { Decimal };

/** Anything that stringifies to a decimal: a string, a number, or a Decimal. */
export type DecimalInput = string | number | { toString(): string };

export function dec(value: DecimalInput): Decimal {
	return new Dec(typeof value === "number" ? value : value.toString());
}

/**
 * A float read as the decimal it was meant to be: 15 significant digits, all
 * a float reliably keeps, so 1.005 * 100 (100.49999999999999) reads as 100.5.
 * The one float-noise trim, used wherever a number enters money math.
 */
export function fromFloat(n: number): Decimal {
	return dec(Number(n.toPrecision(15)));
}

/**
 * A decimal as the float a client that still takes numbers can hold. The one
 * place a Decimal becomes a number, for a DTO field or a form draft:
 *
 * - Without `significant` it is exact: it throws when the float does not read
 *   back as the same decimal (more digits than a float keeps, such as 2^53 + 1
 *   or 19 digits), so a stored value never silently loses digits.
 * - With `significant` it trims to that many significant digits (15 is all a
 *   float reliably keeps, the inverse of fromFloat), for a computed figure
 *   such as a ratio, where the 40-digit tail is noise. A money figure rounds
 *   to its currency first (roundedMajor) or leaves as minor units.
 *
 * Call it only as an object literal property value or a return value, never
 * in arithmetic or through a variable: the ratchet counts those
 * (src/test/money/arithmetic.test.ts).
 */
export function toFloat(value: DecimalInput, significant?: number): number {
	const exact = dec(value);
	if (significant !== undefined)
		return Number(exact.toSignificantDigits(significant).toString());
	const n = Number(exact.toString());
	if (!dec(n).eq(exact))
		throw new RangeError(`${exact.toString()} does not fit a number exactly`);
	return n;
}
