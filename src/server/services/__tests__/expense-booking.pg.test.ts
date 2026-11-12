/**
 * Booking an expense rounds half to even, and an edit that moves no money
 * keeps what was saved (money-decimal plan, D1). ARS home, one blue rate of
 * ARS 100 per USD on 2019-03-07 (a date no other file stores an ARS rate
 * near). Hand-derived:
 *
 * - ARS 28.5 is 0.285 USD: 8 is even, so 0.28 (half up gave 0.29). Home
 *   amount 28.50 (the entry is in the home currency).
 * - ARS 0.5 is 0.005 USD: 0 is even, so 0.00 (half up gave 0.01). Refund
 *   ties are the domain's tests: the schema keeps expense amounts above 0.
 * - A row booked half up before this change holds 0.29 for ARS 28.5. A title
 *   edit keeps 0.29; an edit to ARS 30 books 30 / 100 = 0.30; moving it a
 *   day re-books at its kept rate, 28.5 / 100 = 0.28.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { updateExpenseEntry } from "~/server/services/entry/expense.mutation";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

const DAY = new Date("2019-03-07T00:00:00.000Z");
const NEXT_DAY = new Date("2019-03-08T00:00:00.000Z");

beforeAll(async () => {
	await adminDb.exchangeRate.upsert({
		where: { date_currency_type: { date: DAY, currency: "ARS", type: "blue" } },
		create: { date: DAY, currency: "ARS", type: "blue", rate: "100" },
		update: { rate: "100" },
	});
});

async function arsUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS", defaultRateTypes: {} },
	});
	return user.id;
}

const money = async (id: string) => {
	const r = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
	return {
		amount: r.amount.toString(),
		amountInUSD: r.amountInUSD.toString(),
		exchangeRate: r.exchangeRate.toString(),
		homeAmount: r.homeAmount?.toString(),
	};
};

describe("booking an expense rounds half to even", () => {
	it("ARS 28.5 books 0.28 USD, the preview first", async () => {
		const userId = await arsUser();
		const input = {
			id: randomUUID(),
			title: "Kiosk",
			amount: "28.5",
			currency: "ARS",
			date: DAY,
		};
		const preview = await forUser(userId).preview(createExpense, input);
		expect(preview.value.amountInUSD.toString()).toBe("0.28");
		await forUser(userId).apply(createExpense, input);
		expect(await money(input.id)).toEqual({
			amount: "28.5",
			amountInUSD: "0.28",
			exchangeRate: "100",
			homeAmount: "28.5",
		});
	});

	it("ARS 0.5 is 0.005 USD: 0.00", async () => {
		const userId = await arsUser();
		const id = randomUUID();
		await forUser(userId).apply(createExpense, {
			id,
			title: "Candy",
			amount: "0.5",
			currency: "ARS",
			date: DAY,
		});
		expect((await money(id)).amountInUSD).toBe("0");
	});
});

describe("an edit that moves no money keeps the saved figures (D1)", () => {
	/** ARS 28.5 as a half-up booking saved it: 0.285 USD stored as 0.29. */
	async function oldTieRow() {
		const userId = await arsUser();
		const id = randomUUID();
		await fixtureDb.expense.create({
			data: {
				id,
				userId,
				title: "Kiosk",
				amount: "28.5",
				currency: "ARS",
				date: DAY,
				exchangeRate: "100",
				amountInUSD: "0.29",
				pricingSource: "MANUAL",
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1",
				homeAmount: "28.50",
				status: "FINALIZED",
			},
		});
		return { userId, id };
	}

	const edit = (id: string, over: { amount?: string; date?: Date } = {}) => ({
		id,
		title: "Corner kiosk",
		amount: over.amount ?? "28.5",
		currency: "ARS",
		date: over.date ?? DAY,
		exchangeRate: 100,
		pricingSource: "MANUAL",
		rateType: "blue",
	});

	it("a title edit keeps 0.29 and the home amount", async () => {
		const { userId, id } = await oldTieRow();
		await forUser(userId).apply(updateExpenseEntry, edit(id));
		expect(await money(id)).toEqual({
			amount: "28.5",
			amountInUSD: "0.29",
			exchangeRate: "100",
			homeAmount: "28.5",
		});
		const row = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
		expect(row.title).toBe("Corner kiosk");
	});

	it("a new amount re-books: ARS 30 is 0.30 USD", async () => {
		const { userId, id } = await oldTieRow();
		await forUser(userId).apply(updateExpenseEntry, edit(id, { amount: "30" }));
		expect(await money(id)).toMatchObject({
			amountInUSD: "0.3",
			homeAmount: "30",
		});
	});

	it("a new date re-books at the kept rate: 0.285 rounds to 0.28", async () => {
		const { userId, id } = await oldTieRow();
		await forUser(userId).apply(
			updateExpenseEntry,
			edit(id, { date: NEXT_DAY }),
		);
		expect(await money(id)).toMatchObject({
			amountInUSD: "0.28",
			homeAmount: "28.5",
		});
	});
});
