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
 *   day re-books at its kept rate, 28.5 / 100 = 0.28. Undoing the ARS 30
 *   edit gives back 0.29.
 * - JPY home, EUR 3 and JPY 1 per USD that day: EUR 4.5 books 2 JPY (1.5, a
 *   tie). After an edit to EUR 6 its undo gives back 2, where booking again
 *   at the kept 12-decimal rate would give 1.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	deleteExpenseEntry,
	restoreExpenseEntry,
	updateExpenseEntry,
} from "~/server/services/entry/expense.mutation";
import { expenseRestoreSchema } from "~/server/services/entry/input";
import type { RestoreToken } from "~/server/services/entry/restore-token";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";

const DAY = new Date("2019-03-07T00:00:00.000Z");
const NEXT_DAY = new Date("2019-03-08T00:00:00.000Z");

beforeAll(async () => {
	for (const [currency, type, rate] of [
		["ARS", "blue", "100"],
		["EUR", "official", "3"],
		["JPY", "official", "1"],
	] as const)
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: DAY, currency, type } },
			create: { date: DAY, currency, type, rate },
			update: { rate },
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

const row = (id: string) =>
	fixtureDb.expense.findUniqueOrThrow({ where: { id } });

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
	async function oldTieRow(date = DAY, owner?: string) {
		const userId = owner ?? (await arsUser());
		const id = randomUUID();
		await fixtureDb.expense.create({
			data: {
				id,
				userId,
				title: "Kiosk",
				amount: "28.5",
				currency: "ARS",
				date,
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
		const saved = await row(id);
		expect(saved.title).toBe("Corner kiosk");
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

	it("the undo of an edit gives back 0.29, its preview first", async () => {
		// Dated today so the undo moves this month's spent: ARS 30.00 back to
		// 28.50 is -1.50 ARS, -150 minor. The edit and the undo read no rate.
		const { userId, id } = await oldTieRow(new Date());
		const edited = await forUser(userId).apply(
			updateExpenseEntry,
			edit(id, { amount: "30", date: (await row(id)).date }),
		);
		expect((await money(id)).amountInUSD).toBe("0.3");

		const preview = await forUser(userId).preview(
			updateExpenseEntry,
			edited.value.restore,
		);
		const undone = await forUser(userId).apply(
			updateExpenseEntry,
			edited.value.restore,
		);
		expect(undone.changes).toEqual(preview.changes);
		expect(preview.changes).toContainEqual(
			expect.objectContaining({
				id: "spent",
				delta: { minor: -150, currency: "ARS" },
			}),
		);
		expect(await money(id)).toEqual({
			amount: "28.5",
			amountInUSD: "0.29",
			exchangeRate: "100",
			homeAmount: "28.5",
		});
	});

	describe("an undo writes only the figures the edit signed for this row", () => {
		const refused = /This undo is not valid anymore/;

		async function editedRow() {
			const { userId, id } = await oldTieRow();
			const edited = await forUser(userId).apply(
				updateExpenseEntry,
				edit(id, { amount: "30" }),
			);
			return { userId, id, restore: edited.value.restore };
		}

		it("plain figures never pass the revert input, and a forged token is refused", async () => {
			const { userId, id, restore } = await editedRow();
			const figures = { exchangeRate: "100", amountInUSD: "999" };
			expect(
				expenseRestoreSchema.safeParse({ ...restore, restore: figures })
					.success,
			).toBe(false);
			const forged = {
				data: JSON.stringify({
					kind: "expense.update",
					id,
					amount: "28.5",
					currency: "ARS",
					date: DAY.toISOString(),
					home: "ARS",
					figures: { ...figures, rateType: null },
				}),
				sig: "0".repeat(64),
			};
			await expect(
				forUser(userId).apply(updateExpenseEntry, {
					...restore,
					restore: forged,
				}),
			).rejects.toThrow(refused);
			expect((await money(id)).amountInUSD).toBe("0.3");
		});

		it("a token for another row, or with a changed amount, is refused", async () => {
			const a = await editedRow();
			const b = await oldTieRow(DAY, a.userId);
			await expect(
				forUser(a.userId).apply(updateExpenseEntry, {
					...a.restore,
					id: b.id,
				}),
			).rejects.toThrow(refused);
			await expect(
				forUser(a.userId).apply(updateExpenseEntry, {
					...a.restore,
					amount: "28.6",
				}),
			).rejects.toThrow(refused);
			expect((await money(a.id)).amountInUSD).toBe("0.3");
		});

		it("another user's token, or a token of another kind, is refused cleanly", async () => {
			const { userId, id, restore } = await editedRow();
			// An edit's token sent to the undo of a delete: a BAD_REQUEST, not a crash.
			await expect(
				forUser(userId).apply(restoreExpenseEntry, {
					token: restore.restore as RestoreToken,
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST", message: refused });
			// A delete's token taken back by another user.
			const gone = await forUser(userId).apply(deleteExpenseEntry, { id });
			const other = await arsUser();
			await expect(
				forUser(other).apply(restoreExpenseEntry, {
					token: gone.value.restore,
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST", message: refused });
			expect(await fixtureDb.expense.count({ where: { id } })).toBe(0);
		});

		it("a token signed under another home currency is refused", async () => {
			const { userId, id, restore } = await editedRow();
			await adminDb.user.update({
				where: { id: userId },
				data: { homeCurrency: "USD" },
			});
			await expect(
				forUser(userId).apply(updateExpenseEntry, restore),
			).rejects.toThrow(refused);
			expect((await money(id)).amountInUSD).toBe("0.3");
		});
	});
});

describe("the undo of an edit writes back the saved figures", () => {
	it("JPY home: EUR 4.5 at 3 per USD books 2, an edit to 6 and its undo give back 2", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "JPY", defaultRateTypes: {} },
		});
		const id = randomUUID();
		const input = {
			id,
			title: "Museum",
			amount: "4.5",
			currency: "EUR",
			date: DAY,
		};
		// 4.5 x 1 x 1 / (3 x 1) = 1.5 JPY, a tie: 2. Home rate 1 / 3 to 12
		// decimals, 0.333333333333; USD 4.5 / 3 = 1.50.
		await forUser(user.id).apply(createExpense, input);
		expect(await money(id)).toEqual({
			amount: "4.5",
			amountInUSD: "1.5",
			exchangeRate: "3",
			homeAmount: "2",
		});
		// The edit keeps the rate: 6 x 0.333333333333 = 1.999999999998, so 2;
		// USD 6 / 3 = 2.00.
		const edited = await forUser(user.id).apply(updateExpenseEntry, {
			...input,
			amount: "6",
			exchangeRate: 3,
			pricingSource: "MANUAL",
			rateType: "official",
		});
		expect(await money(id)).toMatchObject({
			amountInUSD: "2",
			homeAmount: "2",
		});
		// Booking the undo again at the kept rate would give 4.5 x
		// 0.333333333333 = 1.4999999999985, so 1. It writes back 2.
		await forUser(user.id).apply(updateExpenseEntry, edited.value.restore);
		expect(await money(id)).toEqual({
			amount: "4.5",
			amountInUSD: "1.5",
			exchangeRate: "3",
			homeAmount: "2",
		});
	});
});
