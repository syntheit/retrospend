/**
 * Income and transfer fees stay consistent on real Postgres (2D review
 * fixes): counted units never drift from what an account holds (D4), an
 * undone delete books nothing anew, typed amounts stay exact, a row with a
 * leg keeps its money, and Use my plan assigns through the envelope budget.
 * ARS home; ARS 1,468 Blue, 1,412 Official, 1,449 MEP per USD.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmRecurringIncomeSchema } from "~/server/services/accounts/input";
import { updateBalance } from "~/server/services/accounts/update-balance.mutation";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { getMonth } from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { ExpenseService } from "~/server/services/expense.service";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	arsUser,
	balanceOf,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { addIncome } from "./add.mutation";
import {
	confirmRecurringIncome,
	unconfirmRecurringIncome,
} from "./confirm-recurring.mutation";
import { deleteIncome } from "./delete.mutation";
import { moveIn } from "./move-in.mutation";

const countedOn = async (accountId: string) =>
	(
		await adminDb.assetAccount.findUniqueOrThrow({ where: { id: accountId } })
	).countedUnits.toString();

beforeAll(async () => {
	await seedArsRates();
	// DOGE: 8 decimals, so an amount can have more digits than a float keeps
	// (75347129.80735802 reads back as ...803 through a number).
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: TODAY, currency: "DOGE", type: "crypto" },
		},
		create: { date: TODAY, currency: "DOGE", type: "crypto", rate: "0.000001" },
		update: { rate: "0.000001" },
	});
});

async function withWise() {
	const { user } = await arsUser();
	return {
		userId: user.id,
		wise: await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1000, {
			exchangeRateType: "official",
		}),
		savings: await openAccount(user.id, "Savings", "CASH", "ARS", 5_000_000),
	};
}

const freelance = (into: string) => ({
	title: "Estudio Norte",
	amount: "2000",
	currency: "USD",
	rateType: "mep",
	into,
});

describe("counted units follow what the account holds (D4)", () => {
	it("Move in of a kept income counts only what is still in the account", async () => {
		const p = await withWise();
		const income = await forUser(p.userId).apply(addIncome, freelance(p.wise));
		// USD 2,500 of the 3,000 leave for cash nobody tracks.
		await forUser(p.userId).apply(createTransfer, {
			fromAccountId: p.wise,
			toAccountId: null,
			toCurrency: "USD",
			fromAmount: "2500",
		});

		const moved = await forUser(p.userId).apply(moveIn, {
			expenseId: income.value.expenseId,
		});

		expect(await countedOn(p.wise)).toBe("500");
		expect(moved.value.countedUnits).toBe("500");
		// A quarter of the income's booked ARS 2,898,000.
		expect(moved.value.amount).toEqual({ minor: 72_450_000, currency: "ARS" });
	});

	it("deleting a moved-in income from Activity takes its counted units back", async () => {
		const p = await withWise();
		const income = await forUser(p.userId).apply(addIncome, freelance(p.wise));
		await forUser(p.userId).apply(moveIn, {
			expenseId: income.value.expenseId,
		});
		expect(await countedOn(p.wise)).toBe("2000");

		await new ExpenseService(adminDb).deleteExpense(
			p.userId,
			income.value.expenseId,
		);

		expect(await countedOn(p.wise)).toBe("0");
		expect(await balanceOf(p.wise)).toBe("1000");
	});

	it("income the budget counts into an account outside it marks its units counted", async () => {
		const p = await withWise();
		await forUser(p.userId).apply(addIncome, {
			...freelance(p.wise),
			keep: false,
		});
		expect(await countedOn(p.wise)).toBe("2000");

		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: p.userId,
				name: "Retainer",
				amount: "100",
				currency: "USD",
				direction: "IN",
				amountMode: "FIXED",
				frequency: "MONTHLY",
				nextDueDate: TODAY,
				anchorDay: TODAY.getUTCDate(),
				autoPay: false,
			},
		});
		await forUser(p.userId).apply(confirmRecurringIncome, {
			templateId: template.id,
			into: p.wise,
			keep: false,
		});
		expect(await countedOn(p.wise)).toBe("2100");
	});
});

describe("counted units never exceed what an account holds", () => {
	async function outOfBudget(start: number) {
		const { user } = await arsUser();
		return {
			userId: user.id,
			a: await openAccount(user.id, "Wise", "INVESTMENT", "USD", start),
			b: await openAccount(user.id, "USD cash", "CASH", "USD", 0),
		};
	}

	const repro = async (start: number) => {
		const p = await outOfBudget(start);
		const income = await forUser(p.userId).apply(addIncome, {
			...freelance(p.a),
			amount: "100",
			keep: false,
		});
		expect(await countedOn(p.a)).toBe("100");
		// The counted units follow the money to B.
		await forUser(p.userId).apply(createTransfer, {
			fromAccountId: p.a,
			toAccountId: p.b,
			fromAmount: "100",
		});
		const deleted = await forUser(p.userId).apply(deleteIncome, {
			expenseId: income.value.expenseId,
		});
		await forUser(p.userId).apply(addIncome, deleted.value.recreate);
		return p;
	};

	it("an undone delete does not count again units that moved on (from an empty account)", async () => {
		const p = await repro(0);
		expect(await balanceOf(p.a)).toBe("0");
		expect(await countedOn(p.a)).toBe("0");
		expect(await countedOn(p.b)).toBe("100");
	});

	it("an undone delete does not count again units that moved on (with other money there)", async () => {
		const p = await repro(500);
		expect(await balanceOf(p.a)).toBe("500");
		expect(await countedOn(p.a)).toBe("0");
		expect(await countedOn(p.b)).toBe("100");
	});

	it("Update balance downward counts at most the new balance", async () => {
		const p = await withWise();
		await forUser(p.userId).apply(addIncome, {
			...freelance(p.wise),
			keep: false,
		});
		expect(await countedOn(p.wise)).toBe("2000");

		await forUser(p.userId).apply(updateBalance, {
			accountId: p.wise,
			balance: "1500",
		});

		expect(await countedOn(p.wise)).toBe("1500");
	});
});

describe("an undone delete books the income at its original rates", () => {
	const mep = { date: TODAY, currency: "ARS", type: "mep" } as const;

	afterAll(async () => {
		await adminDb.exchangeRate.update({
			where: { date_currency_type: mep },
			data: { rate: "1449" },
		});
	});

	it("a USD income into an ARS account keeps its rate, booked value and units", async () => {
		const p = await withWise();
		const added = await forUser(p.userId).apply(addIncome, {
			...freelance(p.savings),
			amount: "100",
		});
		const deleted = await forUser(p.userId).apply(deleteIncome, {
			expenseId: added.value.expenseId,
		});
		// The day's MEP rate is corrected after the delete.
		await adminDb.exchangeRate.update({
			where: { date_currency_type: mep },
			data: { rate: "1500" },
		});

		const back = await forUser(p.userId).apply(
			addIncome,
			deleted.value.recreate,
		);

		expect(back.value.booked).toEqual(added.value.booked);
		expect(back.value.booked).toEqual({ minor: 14_490_000, currency: "ARS" });
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { expenseId: back.value.expenseId },
		});
		expect(leg.amount.toString()).toBe("144900");
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: back.value.expenseId },
		});
		expect(row.amountInUSD.toString()).toBe("100");
		expect(await balanceOf(p.savings)).toBe("5144900");
	});
});

describe("typed amounts stay exact end to end", () => {
	it("a transfer fee keeps every digit typed", async () => {
		const { user } = await createTestUser();
		const a = await openAccount(user.id, "Hot wallet", "CRYPTO", "DOGE", 1);
		const b = await openAccount(user.id, "Cold wallet", "CRYPTO", "DOGE", 1);

		const { value } = await forUser(user.id).apply(createTransfer, {
			fromAccountId: a,
			toAccountId: b,
			fromAmount: "1",
			fee: { amount: "75347129.80735802" },
		});

		const fee = await adminDb.expense.findUniqueOrThrow({
			where: { id: value.feeExpenseId as string },
		});
		expect(fee.amount.toString()).toBe("75347129.80735802");
	});

	it("a confirmed recurring amount is a decimal string, stored as typed", async () => {
		const { user } = await createTestUser();
		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "Staking",
				amount: "1",
				currency: "DOGE",
				direction: "IN",
				amountMode: "ASK",
				frequency: "MONTHLY",
				nextDueDate: TODAY,
				anchorDay: TODAY.getUTCDate(),
				autoPay: false,
			},
		});
		const input = confirmRecurringIncomeSchema.parse({
			templateId: template.id,
			amount: "75347129.80735802",
		});

		const { value } = await forUser(user.id).apply(
			confirmRecurringIncome,
			input,
		);

		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: value.expenseId },
		});
		expect(row.amount.toString()).toBe("75347129.80735802");
	});
});

describe("a row with a leg keeps its money", () => {
	it("refuses an amount, currency or date edit from Activity; the title is fine", async () => {
		const p = await withWise();
		const { value } = await forUser(p.userId).apply(addIncome, {
			title: "Salary",
			amount: "100000",
			currency: "ARS",
			into: p.savings,
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: value.expenseId },
		});
		const edit = {
			id: row.id,
			title: row.title,
			amount: 100000,
			currency: "ARS",
			date: row.date,
		};
		const service = new ExpenseService(adminDb);

		for (const change of [
			{ amount: 120000 },
			{ currency: "USD" },
			{ date: new Date(row.date.getTime() - 86_400_000) },
		]) {
			await expect(
				service.updateExpense(p.userId, { ...edit, ...change }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		await service.updateExpense(p.userId, { ...edit, title: "June salary" });
		expect(await balanceOf(p.savings)).toBe("5100000");
	});
});

describe("Use my plan on a recurring income confirm", () => {
	it("assigns the income by the plan in the same action, and its undo takes it back", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: s.user.id,
				name: "Salary",
				amount: "1000",
				currency: "USD",
				direction: "IN",
				amountMode: "FIXED",
				frequency: "MONTHLY",
				nextDueDate: TODAY,
				anchorDay: TODAY.getUTCDate(),
				autoPay: false,
			},
		});

		const assignedNow = async () =>
			(await getMonth(s.user.id))?.groups.flatMap((g) =>
				g.envelopes.map((e) => e.assigned.minor),
			) ?? [];
		const poolBefore = (await getMonth(s.user.id))?.toAssign.amount.minor;

		const result = await forUser(s.user.id).apply(confirmRecurringIncome, {
			templateId: template.id,
			usePlan: true,
		});

		// Rent's 500 set aside and Dining's 200 refill; 300 stays Not planned yet.
		const { plan } = result.value;
		expect(plan).toMatchObject({
			applied: true,
			reason: null,
			rest: { minor: 30_000, currency: "USD" },
		});
		expect(plan.lines.map((l) => l.amount.minor).sort()).toEqual([
			20_000, 50_000,
		]);
		expect((await assignedNow()).reduce((t, m) => t + m, 0)).toBe(70_000);

		await forUser(s.user.id).apply(unconfirmRecurringIncome, {
			expenseId: result.value.expenseId,
		});
		expect((await assignedNow()).every((m) => m === 0)).toBe(true);
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(poolBefore);
	});
});
