/**
 * The 4G review round on real Postgres, values by hand:
 * - typed rates beyond the home currency's minor units: EUR 100 at 1.0834
 *   into USD = USD 108.34; UYU 1,000 at 0.025 = USD 25; IDR 50,000 at
 *   0.0068 into a JPY home = JPY 340;
 * - income and fee rows on the viewer's calendar day (Buenos Aires, Tokyo),
 *   while legs keep the ledger's day;
 * - an emptied note clears on a shared edit;
 * - a repeated create with the same client id writes one row and tells once;
 * - the undo of a delete puts a legacy row back verbatim;
 * - the Undo of a shared create takes its notices back instead of adding one.
 * Run this file under TZ=America/Argentina/Buenos_Aires and TZ=Asia/Tokyo too.
 */
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";

beforeAll(seedArsRates);
import { createExpense } from "../expense-create.mutation";
import { addIncome } from "../income/add.mutation";
import { deleteIncome } from "../income/delete.mutation";
import { createTransfer } from "../transfers/create.mutation";
import { deleteExpenseEntry, restoreExpenseEntry } from "./expense.mutation";
import { toExpenseInput } from "./input";
import {
	createSharedExpense,
	deleteSharedExpense,
	updateSharedExpense,
} from "./shared.mutation";

async function category(userId: string) {
	return adminDb.category.create({
		data: { userId, name: "Travel", color: "teal", kind: "EXPENSE" },
	});
}

const typed = (
	categoryId: string,
	currency: string,
	amount: string,
	customRate: string,
) =>
	toExpenseInput(
		{
			id: crypto.randomUUID(),
			title: "Typed rate",
			amount,
			currency,
			date: isoDay(TODAY),
			categoryId,
			customRate,
		},
		"UTC",
	);

describe("typed rates are rates, not home money", () => {
	it("EUR 100 at 1.0834 and UYU 1,000 at 0.025 in a USD home", async () => {
		const { user } = await createTestUser();
		const cat = await category(user.id);
		const eur = await forUser(user.id).apply(
			createExpense,
			typed(cat.id, "EUR", "100", "1.0834"),
		);
		const uyu = await forUser(user.id).apply(
			createExpense,
			typed(cat.id, "UYU", "1000", "0.025"),
		);
		expect(eur.value.homeAmount?.toString()).toBe("108.34");
		expect(eur.value.homeRate?.toString()).toBe("1.0834");
		expect(uyu.value.homeAmount?.toString()).toBe("25");
	});

	it("IDR 50,000 at 0.0068 into a JPY home is JPY 340", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "JPY" },
		});
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: { date: TODAY, currency: "JPY", type: "official" },
			},
			create: { date: TODAY, currency: "JPY", type: "official", rate: "150" },
			update: {},
		});
		const cat = await category(user.id);
		const idr = await forUser(user.id).apply(
			createExpense,
			typed(cat.id, "IDR", "50000", "0.0068"),
		);
		expect(idr.value.homeAmount?.toString()).toBe("340");
	});
});

describe.each([
	"America/Argentina/Buenos_Aires",
	"Asia/Tokyo",
])("calendar days in %s", (timeZone) => {
	const day = "2026-10-01";

	it("an income row sits on its day in the viewer's zone; its leg keeps the ledger day", async () => {
		const { user } = await createTestUser();
		const wallet = await openAccount(user.id, "Wallet", "CASH", "USD", 100, {}, 60);
		const r = await forUser(user.id).apply(addIncome, {
			title: "Salary",
			amount: "500",
			currency: "USD",
			date: day,
			into: wallet,
			timeZone,
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: r.value.expenseId },
			include: { accountLegs: true },
		});
		expect(row.date).toEqual(parseDateOnlyIn(day, timeZone));
		expect(dayKey(row.date, timeZone)).toBe(day);
		expect(row.accountLegs[0]?.date.toISOString()).toBe(`${day}T00:00:00.000Z`);

		const gone = await forUser(user.id).apply(deleteIncome, {
			expenseId: r.value.expenseId,
			timeZone,
		});
		expect(gone.value.recreate.date).toBe(day);
	});

	it("an income without an account keeps its day through delete and recreate", async () => {
		const { user } = await createTestUser();
		const r = await forUser(user.id).apply(addIncome, {
			title: "Gift",
			amount: "50",
			currency: "USD",
			date: day,
			timeZone,
		});
		const gone = await forUser(user.id).apply(deleteIncome, {
			expenseId: r.value.expenseId,
			timeZone,
		});
		expect(gone.value.recreate.date).toBe(day);
	});

	it("a transfer's fee is an expense on the viewer's day", async () => {
		const { user } = await createTestUser();
		const a = await openAccount(user.id, "A", "CASH", "USD", 1000, {}, 60);
		const b = await openAccount(user.id, "B", "CASH", "USD", 0, {}, 60);
		const r = await forUser(user.id).apply(createTransfer, {
			fromAccountId: a,
			toAccountId: b,
			fromAmount: "100",
			fee: { amount: "2" },
			date: day,
			timeZone,
		});
		const fee = await adminDb.expense.findUniqueOrThrow({
			where: { id: r.value.feeExpenseId ?? "" },
		});
		expect(dayKey(fee.date, timeZone)).toBe(day);
	});
});

async function pair() {
	const { user } = await arsUser();
	const { user: other } = await createTestUser();
	const me = { participantType: "user" as const, participantId: user.id };
	const them = { participantType: "user" as const, participantId: other.id };
	const input = {
		amount: 6000,
		currency: "ARS",
		description: "Dinner",
		date: TODAY,
		paidBy: me,
		splitWith: [me, them],
		splitMode: "EQUAL" as const,
	};
	const told = () => adminDb.notification.findMany({ where: { userId: other.id } });
	return { user, other, me, them, input, told };
}

const send = async (queue: (() => Promise<void>)[]) => {
	for (const s of queue) await s();
};

describe("shared expenses", () => {
	it("an emptied note clears on edit", async () => {
		const p = await pair();
		const made = await forUser(p.user.id).apply(createSharedExpense, {
			...p.input,
			notes: "Window table",
		});
		await forUser(p.user.id).apply(updateSharedExpense, {
			id: made.value.id,
			...p.input,
			notes: null,
		});
		const row = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: made.value.id },
		});
		expect(row.notes).toBeNull();
	});

	it("a create repeated with the same client id writes one row and tells once", async () => {
		const p = await pair();
		const id = crypto.randomUUID();
		const first: (() => Promise<void>)[] = [];
		const second: (() => Promise<void>)[] = [];
		await forUser(p.user.id).apply(createSharedExpense, { ...p.input, id, notify: first });
		await expect(
			forUser(p.user.id).apply(createSharedExpense, { ...p.input, id, notify: second }),
		).rejects.toThrow();
		await send(first);
		expect(second).toEqual([]);
		expect(await adminDb.sharedTransaction.count({ where: { id } })).toBe(1);
		expect(await p.told()).toHaveLength(1);
	});

	it("the Undo of a create takes back its notice and tells nothing new", async () => {
		const p = await pair();
		const made: (() => Promise<void>)[] = [];
		const r = await forUser(p.user.id).apply(createSharedExpense, { ...p.input, notify: made });
		await send(made);
		expect((await p.told()).map((n) => n.type)).toEqual(["EXPENSE_SPLIT"]);

		const undo: (() => Promise<void>)[] = [];
		await forUser(p.user.id).apply(deleteSharedExpense, {
			id: r.value.id,
			confirmUnsettled: true,
			retract: true,
			notify: undo,
		});
		await send(undo);
		expect(await p.told()).toEqual([]);
	});

	it("a plain delete still tells the people on it", async () => {
		const p = await pair();
		const r = await forUser(p.user.id).apply(createSharedExpense, p.input);
		const queue: (() => Promise<void>)[] = [];
		await forUser(p.user.id).apply(deleteSharedExpense, {
			id: r.value.id,
			confirmUnsettled: true,
			notify: queue,
		});
		await send(queue);
		expect((await p.told()).map((n) => n.type)).toEqual(["EXPENSE_DELETED"]);
	});
});

describe("repeated saves with a client id", () => {
	it("income and transfer write once", async () => {
		const { user } = await createTestUser();
		const a = await openAccount(user.id, "A", "CASH", "USD", 1000);
		const b = await openAccount(user.id, "B", "CASH", "USD", 0);
		const id = crypto.randomUUID();
		const income = { id, title: "Gift", amount: "10", currency: "USD" };
		await forUser(user.id).apply(addIncome, income);
		await expect(forUser(user.id).apply(addIncome, income)).rejects.toThrow();
		expect(await adminDb.expense.count({ where: { id } })).toBe(1);

		const tid = crypto.randomUUID();
		const move = { id: tid, fromAccountId: a, toAccountId: b, fromAmount: "5" };
		await forUser(user.id).apply(createTransfer, move);
		await expect(forUser(user.id).apply(createTransfer, move)).rejects.toThrow();
		expect(await adminDb.transfer.count({ where: { id: tid } })).toBe(1);
	});
});

describe("the undo of a delete", () => {
	it("puts a legacy row back verbatim: no rate type, template link, status, timestamps", async () => {
		const { user } = await arsUser();
		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "Streamly",
				amount: "12",
				currency: "USD",
				frequency: "MONTHLY",
				nextDueDate: TODAY,
				anchorDay: 1,
				autoPay: false,
			},
		});
		const id = crypto.randomUUID();
		await adminDb.expense.create({
			data: {
				id,
				userId: user.id,
				title: "Streamly",
				amount: "12",
				currency: "USD",
				date: new Date("2025-03-05T03:00:00.000Z"),
				amountInUSD: "12",
				exchangeRate: "1",
				pricingSource: "RECURRING",
				status: "FINALIZED",
				recurringTemplateId: template.id,
				createdAt: new Date("2025-03-05T12:00:00.000Z"),
			},
		});
		const before = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(before.rateType).toBeNull();

		const gone = await forUser(user.id).apply(deleteExpenseEntry, { id });
		await forUser(user.id).apply(restoreExpenseEntry, { token: gone.value.restore });
		const back = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(back).toEqual(before);
	});

	it("refuses a token that was changed on the way", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id);
		const r = await forUser(user.id).apply(
			createExpense,
			typed(cat.id, "USD", "10", "1500"),
		);
		const gone = await forUser(user.id).apply(deleteExpenseEntry, { id: r.value.id });
		const forged = {
			...gone.value.restore,
			data: gone.value.restore.data.replace('"1500"', '"9999"'),
		};
		await expect(
			forUser(user.id).apply(restoreExpenseEntry, { token: forged }),
		).rejects.toThrow("not valid");
	});
});
