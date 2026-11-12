// Input for arithmetic.test.ts's self-test: each line says what the ratchet
// must count there. Never imported; it only has to typecheck.
import { dec } from "@retrospend/domain/precise-decimal";
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
