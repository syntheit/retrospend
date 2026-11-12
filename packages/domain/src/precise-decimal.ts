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
