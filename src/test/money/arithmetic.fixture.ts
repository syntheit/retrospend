// Input for arithmetic.test.ts's self-test: each line says what the ratchet
// must count there. Never imported; it only has to typecheck.
import {
	type PrismaDecimal,
	toNumber,
	toNumberOrNull,
	toNumberWithDefault,
} from "@retrospend/domain/decimal";
import { type DecimalInput, dec } from "@retrospend/domain/precise-decimal";
import type { Prisma } from "~prisma";

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
	const g = toNumber(cost); // float: decimal.ts helper
	const h = toNumberWithDefault(cost); // float: helper, defaults to 0
	const i = toNumberOrNull(cost); // float: helper
	const j = Number(text); // nothing: a string
	const k = Number(count); // nothing: already a number
	const l = +count; // nothing
	const m = Number(when.getTime()); // nothing
	return [a, b, c, d, e, f, g, h, i, j, k, l, m];
}
