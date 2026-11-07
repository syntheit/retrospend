/**
 * The starting balance raises To assign but is not money that came in.
 * ARS home, start with 500,000.00 and one income of 100,000.00 this month.
 * Expected values by hand (minor units, 2 decimals):
 *
 *   Money in (terms.moneyIn, figure budget.moneyIn): 10,000,000
 *   Starting balance (terms.startingMoney):          50,000,000
 *   To assign: 60,000,000 (both counted, nothing assigned yet).
 *   Without income: Money in is 0, the starting balance still 50,000,000.
 *
 * Money in is cumulative through the viewed month, so a starting balance
 * counts only from the month it is dated in. The book is set up last month
 * without an amount, with income of 100,000.00 (10,000,000) dated last month.
 * This month the answer 600,000.00 is confirmed: the budget holds 10,000,000
 * (last month's income), so the row is 60,000,000 - 10,000,000 = 50,000,000,
 * dated today because last month has closed.
 *
 *   Last month: Money in 10,000,000, starting balance 0, To assign 10,000,000.
 *   This month: Money in 10,000,000, starting balance 50,000,000,
 *               To assign 60,000,000.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { arsUser, seedArsRates } from "../accounts/test-fixtures";
import { setupInput } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import { confirmStartingMoneyMutation } from "./crud.mutation";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

beforeAll(seedArsRates);

const income = (userId: string, date: Date) =>
	adminDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "Salary",
			amount: new Prisma.Decimal(100_000),
			currency: "ARS",
			date,
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

describe("a starting balance confirmed after the first month", () => {
	it("stays out of the month before it, and shows in the month it is dated in", async () => {
		const { user } = await arsUser();
		const cat = (name: string) =>
			adminDb.category
				.create({ data: { name, color: "blue", userId: user.id } })
				.then((c) => c.id);
		const ids = { rent: await cat("Rent"), dining: await cat("Dining") };
		await forUser(user.id).apply(setupEnvelopeBook, {
			...setupInput(ids),
			startingMoneyMinor: undefined,
			timeZone: "UTC",
		});
		// Move the book's start back one month, as if it was set up then.
		const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
			{ fromMonth: 0, startDay: 1 },
		]);
		const last = addMonths(current, -1);
		const lastIso = `${Math.floor(last / 100)}-${String(last % 100).padStart(2, "0")}`;
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: user.id },
		});
		await adminDb.budgetBook.update({
			where: { id: book.id },
			data: {
				startMonth: last,
				startDate: new Date(`${lastIso}-01T00:00:00Z`),
			},
		});
		await adminDb.bookPeriod.updateMany({
			where: { bookId: book.id },
			data: { fromMonth: last },
		});
		await income(user.id, new Date(`${lastIso}-12T15:00:00Z`));

		const a = await forUser(user.id).apply(confirmStartingMoneyMutation, {
			id: randomUUID(),
			amountMinor: 60_000_000,
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: a.value.expenseId as string },
		});
		expect(row.amount).toEqual(new Prisma.Decimal(500_000));
		expect(isoDateIn(row.date, "UTC").slice(0, 7)).toBe(
			isoDateIn(new Date(), "UTC").slice(0, 7),
		);

		const before = await getMonth(user.id, last);
		expect(before?.toAssign.terms.moneyIn).toEqual(ars(10_000_000));
		expect(before?.toAssign.terms.startingMoney).toEqual(ars(0));
		expect(before?.toAssign.amount).toEqual(ars(10_000_000));

		const now = await getMonth(user.id, current);
		expect(now?.toAssign.terms.moneyIn).toEqual(ars(10_000_000));
		expect(now?.toAssign.terms.startingMoney).toEqual(ars(50_000_000));
		expect(now?.toAssign.amount).toEqual(ars(60_000_000));
	});
});
