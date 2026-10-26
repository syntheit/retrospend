/**
 * Minor-unit arithmetic for the envelope modules. Integer math runs on
 * BigInt, decimal inputs on a 40-digit Prisma Decimal, so no float ever
 * touches money. Rounding is half-even (IMPLEMENTATION §2.2).
 *
 * These belong in packages/domain once that package exists; they live here
 * so the pure modules have no dependency on work in flight.
 */
import { Decimal } from "@prisma/client/runtime/index-browser";
import { currencyDecimals } from "@retrospend/domain/money";
import type { DecimalLike, Minor } from "./types";

/** Decimal with enough precision for amount x rate x 10^8 without loss. */
export const Dec = Decimal.clone({
	precision: 40,
	rounding: Decimal.ROUND_HALF_EVEN,
});

export function dec(value: DecimalLike | number): Decimal {
	return new Dec(typeof value === "number" ? value : value.toString());
}

export function assertMinor(value: number, what = "amount"): Minor {
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(`${what} must be a safe integer, got ${value}`);
	}
	return value;
}

/** A decimal amount in `currency` as minor units, rounded half-even. */
export function toMinor(amount: DecimalLike, currency: string): Minor {
	const scaled = dec(amount)
		.mul(dec(10).pow(currencyDecimals(currency)))
		.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
	return assertMinor(scaled.toNumber(), `${currency} amount`);
}

/** Minor units back to a decimal amount in `currency`. */
export function fromMinor(minor: Minor, currency: string): Decimal {
	return dec(assertMinor(minor)).div(dec(10).pow(currencyDecimals(currency)));
}

export function sumMinor(values: Iterable<Minor>): Minor {
	let total = 0n;
	for (const v of values) total += BigInt(assertMinor(v));
	return assertMinor(Number(total), "sum");
}

/** n / d for BigInts, rounded half-even. d must not be 0. */
function divHalfEven(n: bigint, d: bigint): bigint {
	if (d === 0n) throw new RangeError("division by zero");
	if (d < 0n) return divHalfEven(-n, -d);
	const q = n / d;
	const r = n % d;
	if (r === 0n) return q;
	const twice = (r < 0n ? -r : r) * 2n;
	const away = n < 0n ? q - 1n : q + 1n;
	if (twice > d) return away;
	if (twice < d) return q;
	return q % 2n === 0n ? q : away;
}

/** a x num / den, exact, rounded half-even. */
export function mulDiv(a: Minor, num: number, den: number): Minor {
	const out = divHalfEven(
		BigInt(assertMinor(a)) * BigInt(assertMinor(num, "numerator")),
		BigInt(assertMinor(den, "denominator")),
	);
	return assertMinor(Number(out), "result");
}

/** Ceiling of a / b for b > 0 (bill and goal needs round up, SPEC §5.4). */
export function ceilDiv(a: Minor, b: number): Minor {
	if (!Number.isSafeInteger(b) || b <= 0) {
		throw new RangeError(`divisor must be a positive integer, got ${b}`);
	}
	const n = BigInt(assertMinor(a));
	const d = BigInt(b);
	const q = n / d;
	return Number(n % d > 0n ? q + 1n : q);
}

/** `basisPoints` of `amount` (2000 bp = 20%), rounded half-even. */
export function percentOf(amount: Minor, basisPoints: number): Minor {
	return mulDiv(amount, basisPoints, 10_000);
}

/** part / base in basis points, rounded half-even; null when base is 0. */
export function ratioBp(part: Minor, base: Minor): number | null {
	if (base === 0) return null;
	return mulDiv(part, 10_000, base);
}
