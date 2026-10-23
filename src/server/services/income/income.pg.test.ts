/**
 * Income on real Postgres (MONEY-MOVES §2.2, INCOME.md, 2D.2): Add income
 * into an account or not, kept in Wealth or in the budget, Repeats; Move in
 * counting without selling (I16, D4); recurring income confirmed and
 * planned in one action. ARS home; ARS 1,468 Blue, 1,412 Official, 1,449 MEP.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { adminDb } from "~/test/pg-harness";
import {
	arsUser,
	balanceOf,
	figureMinor,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { type AddIncomeInput, addIncome } from "./add.mutation";
import {
	confirmRecurringIncome,
	unconfirmRecurringIncome,
} from "./confirm-recurring.mutation";
import { deleteIncome } from "./delete.mutation";
import { moveIn, undoMoveIn } from "./move-in.mutation";

beforeAll(seedArsRates);

const ARS = (minor: number) => ({ minor, currency: "ARS" });
const delta = (
	result: { changes: readonly { id: string; delta: unknown }[] },
	id: string,
) => result.changes.find((c) => c.id === id)?.delta ?? null;
const unchanged = (result: { unchanged: readonly { id: string }[] }) =>
	result.unchanged.map((u) => u.id);

async function places() {
	const { user } = await arsUser();
	return {
		userId: user.id,
		savings: await openAccount(user.id, "Savings", "CASH", "ARS", 5_000_000),
		wallet: await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		),
		wise: await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1840.55, {
			exchangeRateType: "official",
		}),
	};
}

const freelance = (wise: string): AddIncomeInput => ({
	title: "Estudio Norte",
	amount: "2000",
	currency: "USD",
	rateType: "mep",
	into: wise,
});

describe("income.add", () => {
	it("salary into Savings is in the budget; Savings and net worth move (Example F)", async () => {
		const p = await places();
		const result = await forUser(p.userId).apply(addIncome, {
			title: "Salary",
			amount: "2950000",
			currency: "ARS",
			into: p.savings,
		});

		expect(result.value).toMatchObject({
			kept: false,
			booked: ARS(295_000_000),
		});
		expect(await balanceOf(p.savings)).toBe("7950000");
		expect(delta(result, "netWorth")).toEqual(ARS(295_000_000));
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: result.value.expenseId },
		});
		expect(row).toMatchObject({
			direction: "IN",
			inType: "INCOME",
			keepInWealth: false,
		});
	});

	it("with no account it moves no account and no net worth (N75)", async () => {
		const p = await places();
		const result = await forUser(p.userId).apply(addIncome, {
			title: "Gift",
			amount: "100000",
			currency: "ARS",
		});

		expect(result.value).toMatchObject({ kept: false, into: null });
		expect(unchanged(result)).toEqual(
			expect.arrayContaining(["netWorth", "accounts.balance"]),
		);
		expect(
			await adminDb.accountLeg.count({ where: { userId: p.userId } }),
		).toBe(0);
	});

	it("USD 2,000 at MEP kept in Wise, valued at Official (Example G)", async () => {
		const p = await places();
		const result = await forUser(p.userId).apply(addIncome, freelance(p.wise));

		expect(result.value).toMatchObject({
			kept: true,
			booked: ARS(289_800_000),
		});
		expect(await balanceOf(p.wise)).toBe("3840.55");
		expect(delta(result, "netWorth")).toEqual(ARS(282_400_000));
		expect(delta(result, "netWorthChange.income")).toEqual(ARS(289_800_000));
		expect(delta(result, "netWorthChange.revaluation")).toEqual(
			ARS(-7_400_000),
		);
	});

	it("keeping income in Wealth needs an account", async () => {
		const p = await places();
		await expect(
			forUser(p.userId).apply(addIncome, {
				title: "Cash",
				amount: "1",
				currency: "ARS",
				keep: true,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("Repeats creates the recurring income template and links it", async () => {
		const p = await places();
		const { value } = await forUser(p.userId).apply(addIncome, {
			title: "Salary",
			amount: "2950000",
			currency: "ARS",
			into: p.savings,
			repeats: { frequency: "MONTHLY" },
		});

		const template = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: value.templateId ?? "" },
		});
		expect(template).toMatchObject({
			direction: "IN",
			frequency: "MONTHLY",
			name: "Salary",
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: value.expenseId },
		});
		const [y, m, d] = row.date
			.toISOString()
			.slice(0, 10)
			.split("-")
			.map(Number);
		// One month after the income's own day, whatever the server's zone.
		expect(template.nextDueDate.toISOString().slice(0, 10)).toBe(
			new Date(Date.UTC(y ?? 0, m ?? 0, d)).toISOString().slice(0, 10),
		);
		expect(row.recurringTemplateId).toBe(template.id);
	});

	it("undo removes the row, its leg and its template; recreate brings the row back", async () => {
		const p = await places();
		const { value } = await forUser(p.userId).apply(addIncome, {
			title: "Salary",
			amount: "2950000",
			currency: "ARS",
			into: p.savings,
			repeats: { frequency: "MONTHLY" },
		});
		const removed = await forUser(p.userId).apply(deleteIncome, {
			expenseId: value.expenseId,
			templateId: value.templateId,
		});

		expect(await balanceOf(p.savings)).toBe("5000000");
		expect(await adminDb.expense.count({ where: { userId: p.userId } })).toBe(
			0,
		);
		expect(
			await adminDb.recurringTemplate.count({ where: { userId: p.userId } }),
		).toBe(0);

		await forUser(p.userId).apply(addIncome, removed.value.recreate);
		expect(await balanceOf(p.savings)).toBe("7950000");
		expect(
			await adminDb.expense.findUnique({ where: { id: value.expenseId } }),
		).not.toBeNull();
	});
});

describe("legs and balances stay in step", () => {
	it("an income deleted outside these services takes its balance with it", async () => {
		const p = await places();
		const { value } = await forUser(p.userId).apply(addIncome, {
			title: "Salary",
			amount: "2950000",
			currency: "ARS",
			into: p.savings,
		});
		// As Activity's delete does: the row goes, its leg cascades.
		await adminDb.expense.delete({ where: { id: value.expenseId } });
		expect(await balanceOf(p.savings)).toBe("5000000");
	});
});

describe("income.moveIn (count only)", () => {
	it("I16 count-only moves change no account: Move in and its undo leave every balance", async () => {
		const p = await places();
		const { value: income } = await forUser(p.userId).apply(
			addIncome,
			freelance(p.wise),
		);
		const before = await figureMinor(p.userId, "netWorth");

		const moved = await forUser(p.userId).apply(moveIn, {
			expenseId: income.expenseId,
		});
		expect(unchanged(moved)).toEqual(
			expect.arrayContaining(["netWorth", "accounts.balance"]),
		);
		expect(await balanceOf(p.wise)).toBe("3840.55");

		const undone = await forUser(p.userId).apply(undoMoveIn, {
			expenseId: income.expenseId,
		});
		expect(unchanged(undone)).toEqual(
			expect.arrayContaining(["netWorth", "accounts.balance"]),
		);
		expect(await balanceOf(p.wise)).toBe("3840.55");
		expect(await figureMinor(p.userId, "netWorth")).toBe(before);
		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id: p.wise },
		});
		expect(account.countedUnits.toString()).toBe("0");
	});

	it("I20 one value per transaction: Move in counts the income's booked value, not today's", async () => {
		const p = await places();
		const { value: income } = await forUser(p.userId).apply(
			addIncome,
			freelance(p.wise),
		);
		const moved = await forUser(p.userId).apply(moveIn, {
			expenseId: income.expenseId,
		});

		// Booked at MEP (2,898,000), though Wise values the dollars at Official (2,824,000).
		expect(moved.value.amount).toEqual(income.booked);
		expect(moved.value.amount).toEqual(ARS(289_800_000));
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: income.expenseId },
		});
		// Dated today, in the same zone as the income itself.
		expect(row.movedInAt?.getTime()).toBe(row.date.getTime());
		await expect(
			forUser(p.userId).apply(moveIn, { expenseId: income.expenseId }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("D4 counted units leave first and never enter the budget twice", async () => {
		const p = await places();
		const { value: income } = await forUser(p.userId).apply(
			addIncome,
			freelance(p.wise),
		);
		await forUser(p.userId).apply(moveIn, { expenseId: income.expenseId });

		// Selling USD 1,000 that were all counted: the budget does not move.
		const first = await forUser(p.userId).apply(createTransfer, {
			fromAccountId: p.wise,
			toAccountId: p.wallet,
			fromAmount: "1000",
			toAmount: "1460000",
		});
		expect(first.value.budget).toMatchObject({ effect: "counted" });
		// Selling 1,500 more: 1,000 counted, 500 fresh, 2,190,000 x 500 / 1,500 enters.
		const second = await forUser(p.userId).apply(createTransfer, {
			fromAccountId: p.wise,
			toAccountId: p.wallet,
			fromAmount: "1500",
			toAmount: "2190000",
		});
		expect(second.value.budget).toMatchObject({
			effect: "enters",
			minor: 73_000_000,
		});
		const wise = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id: p.wise },
		});
		expect(wise.countedUnits.toString()).toBe("0");
		// The counted dollars have left, so the Move in can no longer be undone.
		await expect(
			forUser(p.userId).apply(undoMoveIn, { expenseId: income.expenseId }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});

	it("Wealth money not tied to an income counts at today's value", async () => {
		const p = await places();
		const moved = await forUser(p.userId).apply(moveIn, {
			accountId: p.wise,
			units: "100",
		});
		expect(moved.value.amount).toEqual(ARS(14_120_000));
		await expect(
			forUser(p.userId).apply(moveIn, { accountId: p.wise, units: "1800" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("income.confirmRecurring", () => {
	async function salaryTemplate(
		userId: string,
		amountMode: "FIXED" | "ASK" = "FIXED",
	) {
		return adminDb.recurringTemplate.create({
			data: {
				userId,
				name: "Salary",
				amount: "850000",
				currency: "ARS",
				direction: "IN",
				amountMode,
				frequency: "MONTHLY",
				nextDueDate: TODAY,
				anchorDay: TODAY.getUTCDate(),
				autoPay: false,
			},
		});
	}

	it("confirms, lands in the account and applies the plan in one action", async () => {
		const p = await places();
		const template = await salaryTemplate(p.userId);

		const result = await forUser(p.userId).apply(confirmRecurringIncome, {
			templateId: template.id,
			dueDate: TODAY,
			into: p.wallet,
			usePlan: true,
		});

		expect(result.value).toMatchObject({
			kept: false,
			booked: ARS(85_000_000),
		});
		// Use my plan needs the envelope engine (2B P2): reported, never faked.
		expect(result.value.plan).toEqual({
			applied: false,
			reason: "no_envelope_budget",
		});
		expect(await balanceOf(p.wallet)).toBe("1850000");
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: result.value.expenseId },
		});
		expect(row).toMatchObject({
			direction: "IN",
			inType: "INCOME",
			recurringTemplateId: template.id,
		});
		const advanced = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: template.id },
		});
		expect(advanced.nextDueDate.getTime()).toBeGreaterThan(TODAY.getTime());

		await expect(
			forUser(p.userId).apply(confirmRecurringIncome, {
				templateId: template.id,
				dueDate: TODAY,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("undo removes the row and puts the template back on its due date", async () => {
		const p = await places();
		const template = await salaryTemplate(p.userId);
		const { value } = await forUser(p.userId).apply(confirmRecurringIncome, {
			templateId: template.id,
			into: p.wallet,
		});

		await forUser(p.userId).apply(unconfirmRecurringIncome, {
			expenseId: value.expenseId,
		});

		expect(await balanceOf(p.wallet)).toBe("1000000");
		expect(await adminDb.expense.count({ where: { userId: p.userId } })).toBe(
			0,
		);
		const back = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: template.id },
		});
		expect(back.nextDueDate.getTime()).toBe(TODAY.getTime());
	});

	it("a varying amount needs the real amount", async () => {
		const p = await places();
		const template = await salaryTemplate(p.userId, "ASK");
		await expect(
			forUser(p.userId).apply(confirmRecurringIncome, {
				templateId: template.id,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const { value } = await forUser(p.userId).apply(confirmRecurringIncome, {
			templateId: template.id,
			amount: 910000,
		});
		expect(value.booked).toEqual(ARS(91_000_000));
	});
});
