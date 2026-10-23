/**
 * A typed rate is a decimal string from the form to the row: no Number on
 * the way, so every digit the column holds is kept. Hand-derived:
 *
 * - Service only (the API refuses past 12 decimals; the Add sheet rounds):
 *   EUR 1,000 at 1.08341234567891234 in a USD home: home rate
 *   1.083412345679 (12 decimals, half-even: ...678|91234 rounds up), home
 *   amount 1,083.41234567891234, so USD 1,083.41. The amount comes from the
 *   exact rate, not the stored copy.
 * - EUR 1,000 at 1,234.567890123 in an ARS home: home rate as typed, ARS
 *   1,234,567.890123, so ARS 1,234,567.89.
 * - EUR 1,000 at 1,234,567.123456789012 in an ARS home (19 digits, more
 *   than a float holds: Number keeps 1234567.123456789): home rate exactly
 *   as typed, ARS 1,234,567,123.456789012, so ARS 1,234,567,123.46. The
 *   expense, its delete and undo, income and the rate strip all keep it.
 * - The undo of an edit puts back EUR 12,345,678,901.12345678 to the last
 *   digit, and refuses a rate booked into a home the user has since left.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { createExpense } from "../expense-create.mutation";
import { addIncome } from "../income/add.mutation";
import { rateOptions } from "../rate-types";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
	updateExpenseEntry,
} from "./expense.mutation";
import { type ExpenseForm, expenseFormSchema, toExpenseInput } from "./input";

beforeAll(seedArsRates);

const LONG = "1234567.123456789012";

async function usdUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "USD" },
	});
	return user.id;
}

async function arsUserId() {
	return (await arsUser()).user.id;
}

async function category(userId: string) {
	const c = await adminDb.category.create({
		data: { userId, name: "Travel", color: "teal", kind: "EXPENSE" },
	});
	return c.id;
}

const eurosForm = (
	id: string,
	categoryId: string,
	customRate: string,
	amount = "1000",
): ExpenseForm => ({
	id,
	title: "Hotel",
	amount,
	currency: "EUR",
	date: isoDay(TODAY),
	categoryId,
	customRate,
});

/** EUR at a typed rate, only as the API accepts it (expenseFormSchema). */
const euros = (...args: Parameters<typeof eurosForm>) =>
	toExpenseInput(expenseFormSchema.parse(eurosForm(...args)), "UTC");

async function bookEuros(userId: string, customRate: string, amount?: string) {
	const id = crypto.randomUUID();
	const input = euros(id, await category(userId), customRate, amount);
	await forUser(userId).apply(createExpense, input);
	return id;
}

const leg = (id: string) =>
	adminDb.expense.findUniqueOrThrow({
		where: { id },
		select: {
			rateType: true,
			homeCurrency: true,
			homeRate: true,
			homeAmount: true,
		},
	});

describe("a typed rate keeps every digit", () => {
	it("service only: EUR 1,000 at 1.08341234567891234 books USD 1,083.41 at 1.083412345679", async () => {
		const userId = await usdUser();
		const id = crypto.randomUUID();
		const form = eurosForm(id, await category(userId), "1.08341234567891234");
		// The API refuses it; the service books what it is given, exactly.
		expect(expenseFormSchema.safeParse(form).success).toBe(false);
		await forUser(userId).apply(createExpense, toExpenseInput(form, "UTC"));
		const r = await leg(id);
		expect(r.rateType).toBe("custom");
		expect(r.homeCurrency).toBe("USD");
		expect(r.homeRate?.toFixed(12)).toBe("1.083412345679");
		expect(r.homeAmount?.toFixed(2)).toBe("1083.41");
	});

	it("EUR 1,000 at 1,234.567890123 books ARS 1,234,567.89", async () => {
		const userId = await arsUserId();
		const r = await leg(await bookEuros(userId, "1234.567890123"));
		expect(r.homeCurrency).toBe("ARS");
		expect(r.homeRate?.toFixed(12)).toBe("1234.567890123000");
		expect(r.homeAmount?.toFixed(2)).toBe("1234567.89");
	});

	it("a 19 digit rate is stored as typed, and the undo of a delete keeps it", async () => {
		const userId = await arsUserId();
		const id = await bookEuros(userId, LONG);
		const r = await leg(id);
		expect(r.homeRate?.toFixed(12)).toBe(LONG);
		expect(r.homeAmount?.toFixed(2)).toBe("1234567123.46");

		const gone = await forUser(userId).apply(deleteExpenseEntry, { id });
		await forUser(userId).apply(restoreExpenseEntry, {
			token: gone.value.restore,
		});
		expect(await leg(id)).toEqual(r);
	});

	it("the undo of an edit books the 19 digit rate again", async () => {
		const userId = await arsUserId();
		const id = await bookEuros(userId, LONG);
		const before = await leg(id);
		const { categoryId } = await adminDb.expense.findUniqueOrThrow({
			where: { id },
		});
		const edited = await forUser(userId).apply(updateExpenseEntry, {
			...euros(id, categoryId as string, "1500"),
			amount: 1000,
		});
		expect((await leg(id)).homeRate?.toFixed()).toBe("1500");

		await forUser(userId).apply(updateExpenseEntry, edited.value.restore);
		expect(await leg(id)).toEqual(before);
	});

	it("income at a 19 digit rate books the same leg", async () => {
		const userId = await arsUserId();
		const saved = await forUser(userId).apply(addIncome, {
			title: "Client in Lisbon",
			amount: "1000",
			currency: "EUR",
			customRate: LONG,
		});
		expect(saved.value.booked).toEqual({
			minor: 123_456_712_346,
			currency: "ARS",
		});
		const r = await leg(saved.value.expenseId);
		expect(r.homeRate?.toFixed(12)).toBe(LONG);
		expect(r.homeAmount?.toFixed(2)).toBe("1234567123.46");
	});

	it("the rate strip books a typed rate as Save does", async () => {
		const userId = await arsUserId();
		const view = await rateOptions(adminDb, userId, {
			currency: "EUR",
			date: TODAY,
			amount: "1000",
			customRate: LONG,
		});
		expect(view.custom).toEqual({
			rateType: "custom",
			homeRate: LONG,
			homeAmount: "1234567123.46",
		});
	});

	it("the undo of an edit puts back every digit of the amount", async () => {
		const userId = await usdUser();
		const id = await bookEuros(userId, "0.5", "12345678901.12345678");
		const row = () => adminDb.expense.findUniqueOrThrow({ where: { id } });
		const before = await row();
		// 12,345,678,901.12345678 x 0.5 = 6,172,839,450.56172839
		expect(before.homeAmount?.toFixed(2)).toBe("6172839450.56");
		const edited = await forUser(userId).apply(updateExpenseEntry, {
			...euros(id, before.categoryId as string, "0.5", "100"),
			amount: 100,
		});
		expect((await row()).amount.toFixed()).toBe("100");

		await forUser(userId).apply(updateExpenseEntry, edited.value.restore);
		const back = await row();
		expect(back.amount.toFixed()).toBe("12345678901.12345678");
		expect(back.homeAmount?.toFixed(2)).toBe("6172839450.56");
	});

	it("refuses the undo of an edit once the home currency changed", async () => {
		const userId = await arsUserId();
		const id = await bookEuros(userId, "1234.567890123");
		const { categoryId } = await adminDb.expense.findUniqueOrThrow({
			where: { id },
		});
		const edited = await forUser(userId).apply(updateExpenseEntry, {
			...euros(id, categoryId as string, "1500"),
			amount: 1000,
		});
		expect(edited.value.restore.customRate?.home).toBe("ARS");
		await adminDb.user.update({
			where: { id: userId },
			data: { homeCurrency: "USD" },
		});
		const after = await leg(id);

		await expect(
			forUser(userId).apply(updateExpenseEntry, edited.value.restore),
		).rejects.toThrow("This rate was into ARS");
		expect(await leg(id)).toEqual(after);
	});
});
