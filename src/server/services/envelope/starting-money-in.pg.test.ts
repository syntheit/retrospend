/**
 * The starting balance raises To assign but is not money that came in.
 * ARS home, start with 500,000.00 and one income of 100,000.00 this month.
 * Expected values by hand (minor units, 2 decimals):
 *
 *   Money in (terms.moneyIn, figure budget.moneyIn): 10,000,000
 *   Starting balance (terms.startingMoney):          50,000,000
 *   To assign: 60,000,000 (both counted, nothing assigned yet).
 *   Without income: Money in is 0, the starting balance still 50,000,000.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { arsUser, seedArsRates } from "../accounts/test-fixtures";
import { setupInput } from "./__tests__/pg-fixture";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

beforeAll(seedArsRates);

async function arsBook() {
	const { user } = await arsUser();
	const cat = (name: string) =>
		adminDb.category
			.create({ data: { name, color: "blue", userId: user.id } })
			.then((c) => c.id);
	const ids = { rent: await cat("Rent"), dining: await cat("Dining") };
	await forUser(user.id).apply(setupEnvelopeBook, {
		...setupInput(ids),
		startingMoneyMinor: 50_000_000,
		timeZone: "UTC",
	});
	return user.id;
}

const ars = (minor: number) => ({ minor, currency: "ARS" });

describe("Money in leaves the starting balance out", () => {
	it("a new budget with no income: Money in is 0, the start has its own term", async () => {
		const id = await arsBook();
		const m = await getMonth(id);
		expect(m?.toAssign.terms.moneyIn).toEqual(ars(0));
		expect(m?.toAssign.terms.startingMoney).toEqual(ars(50_000_000));
		expect(m?.toAssign.amount).toEqual(ars(50_000_000));
		const f = await readFigures(id, ["budget.moneyIn"]);
		expect(f.get("budget.moneyIn")).toEqual([ars(0)]);
	});

	it("with an income of 100,000.00: Money in is that income alone, To assign both", async () => {
		const id = await arsBook();
		await adminDb.expense.create({
			data: {
				id: randomUUID(),
				userId: id,
				title: "Salary",
				amount: new Prisma.Decimal(100_000),
				currency: "ARS",
				date: new Date(),
				amountInUSD: new Prisma.Decimal(100_000).div(1050),
				exchangeRate: new Prisma.Decimal(1050),
				pricingSource: "MANUAL",
				direction: "IN",
				entryKind: "STANDARD",
				inType: "INCOME",
				homeCurrency: "ARS",
				homeRate: new Prisma.Decimal(1),
				homeAmount: new Prisma.Decimal(100_000),
			},
		});
		const m = await getMonth(id);
		expect(m?.toAssign.terms.moneyIn).toEqual(ars(10_000_000));
		expect(m?.toAssign.terms.startingMoney).toEqual(ars(50_000_000));
		expect(m?.toAssign.amount).toEqual(ars(60_000_000));
		const f = await readFigures(id, ["budget.moneyIn"]);
		expect(f.get("budget.moneyIn")).toEqual([ars(10_000_000)]);
	});
});
