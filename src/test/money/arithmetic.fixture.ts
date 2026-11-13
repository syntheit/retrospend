// Input for arithmetic.test.ts's self-test: each line says what the ratchet
// must count there. Never imported; it only has to typecheck.
import type { PrismaDecimal } from "@retrospend/domain/decimal";
import { formatCurrency } from "@retrospend/domain/currency-format";
import { roundedMajor } from "@retrospend/domain/money-minor";
import {
	type DecimalInput,
	dec,
	toFloat,
} from "@retrospend/domain/precise-decimal";
import type { Prisma } from "~prisma";

/** Stand-ins for the helpers that were deleted: any call by these names counts. */
declare function toNumber(value: unknown): number | undefined;
declare function toNumberWithDefault(value: unknown): number;
declare function toNumberOrNull(value: unknown): number | null;

export function fixture(row: { amount: Prisma.Decimal }, rate: string) {
	const a = row.amount.div(rate); // prisma-decimal
	const b = row.amount.toDecimalPlaces(2).toFixed(); // prisma-decimal x2
	const c = dec(row.amount.toString()).div(rate); // nothing: Dec
	const d = +row.amount; // float: unary plus on a Decimal
	const e = c.toNumber(); // float
	const f = parseFloat(rate); // float
	const g = Number(row.amount); // float: names a money value
	const h = Number(rate.length); // nothing
	return [a, b, c, d, e, f, g, h];
}

/** The same leak through types that stand in for a Decimal. */
export function standIns(
	cost: Prisma.Decimal,
	shown: PrismaDecimal,
	given: DecimalInput,
	loose: { toString(): string },
	either: string | { toString(): string },
	text: string,
	count: number,
	when: Date,
) {
	const a = Number(cost); // float: a Prisma Decimal, whatever it is called
	const b = Number(shown); // float: PrismaDecimal
	const c = Number(given); // float: DecimalInput
	const d = Number(loose); // float: { toString(): string }
	const e = +loose; // float: unary plus on the structural type
	const f = Number(either); // float: a union with the structural type
	const g = toNumber(cost); // float: helper by name
	const h = toNumberWithDefault(cost); // float: helper, defaults to 0
	const i = toNumberOrNull(cost); // float: helper
	const j = Number(text); // nothing: a string
	const k = Number(count); // nothing: already a number
	const l = +count; // nothing
	const m = Number(when.getTime()); // nothing
	return [a, b, c, d, e, f, g, h, i, j, k, l, m];
}

/** A function that only returns an edge helper holds the edge value too. */
function wrapper(value: Prisma.Decimal) {
	return toFloat(value);
}

/** Returns only an edge call or 0, through an if: still an edge. */
function guarded(x: Prisma.Decimal | null) {
	if (!x) return 0;
	return toFloat(x);
}

/** Returns an edge call or null through a conditional, and one through try/catch. */
const nullable = (x: Prisma.Decimal | null) => (x == null ? null : toFloat(x));
const tried = (x: Prisma.Decimal) => {
	try {
		return toFloat(x);
	} catch {
		return undefined;
	}
};
/** A method of an object literal. */
const holder = {
	read(x: Prisma.Decimal) {
		return toFloat(x);
	},
};

/** Returns something else too: not a wrapper. */
function mixed(x: Prisma.Decimal) {
	if (x.isZero()) return "none";
	return toFloat(x);
}

/** The edge helpers: a property value or a return value, nowhere else. */
export function edges(cost: Prisma.Decimal, rows: Prisma.Decimal[]) {
	const ok = { amount: toFloat(cost), shown: roundedMajor(cost, "USD") }; // nothing: property values
	const maybe = { rate: rows.length ? toFloat(cost) : null }; // nothing: through a conditional
	const mapped = rows.map((r) => toFloat(r)); // nothing: an arrow's return value
	const viaVariable = toFloat(cost); // float: through a variable
	const rounded = roundedMajor(cost, "USD"); // float: through a variable
	const sum = toFloat(cost) + 1; // float: arithmetic
	const total = rows.reduce((t, r) => t + toFloat(r), 0); // float: a reduce
	const asArgument = Math.max(toFloat(cost), 0); // float: an argument
	const text = formatCurrency(toFloat(cost), "USD"); // nothing: the amount handed to the formatter
	const second = formatCurrency(1, String(toFloat(cost))); // float: not the amount argument
	const both = wrapper(cost) + wrapper(cost); // float x2: a wrapper in arithmetic
	const kept = { value: wrapper(cost) }; // nothing: a wrapper as a property value
	const more = guarded(cost) + guarded(cost); // float x2: an if with 0 and an edge call
	const orNull = (nullable(cost) ?? 0) + (tried(cost) ?? 0); // float x2: a conditional, a try/catch
	const method = holder.read(cost) + 1; // float: an object method
	const other = `${mixed(cost)}`; // nothing: it also returns text
	return [ok, maybe, mapped, viaVariable, rounded, sum, total, asArgument, text, second, both, kept, more, orNull, method, other];
}

/** A hit that is not money, excused by a named entry in the test. */
export function paged(page: { total: number }) {
	return { pages: Number(page.total) }; // float: a money name, excused by the self-test
}
