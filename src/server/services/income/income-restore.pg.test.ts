/**
 * Taking an income delete back writes back the rates and units it was booked
 * at only when income.delete signed them for that row, under the home the
 * user still has. USD home; EUR 1,000 at a typed 1 EUR = 1.0834 USD books
 * USD 1,083.40 (1,000 x 1.0834), and the honest recreate gives back exactly
 * that. A plain figures object never passes the input, a forged token, a
 * token for another row or user or a changed amount is refused, and so is a
 * token signed before the home currency changed, or one sent with another
 * account or keep flag (the units only fit where they were booked).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { recreateIncomeSchema } from "~/server/services/accounts/input";
import {
	arsUser,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { type AddIncomeInput, addIncome } from "./add.mutation";
import { deleteIncome } from "./delete.mutation";

const refused = /This undo is not valid anymore/;

beforeAll(seedArsRates);

async function usdUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "USD" },
	});
	return user.id;
}

const invoice = (title: string): AddIncomeInput => ({
	title,
	amount: "1000",
	currency: "EUR",
	customRate: "1.0834",
});

/** An income added and deleted: its recreate input. */
async function deleted(userId: string, title = "Client in Lisbon") {
	const saved = await forUser(userId).apply(addIncome, invoice(title));
	const gone = await forUser(userId).apply(deleteIncome, {
		expenseId: saved.value.expenseId,
	});
	return gone.value.recreate;
}

const stored = (userId: string) =>
	fixtureDb.expense.findMany({
		where: { userId },
		select: { id: true, amountInUSD: true },
	});

describe("an income recreate writes only the figures its delete signed", () => {
	it("the honest recreate gives back USD 1,083.40", async () => {
		const userId = await usdUser();
		const recreate = await deleted(userId);
		const back = await forUser(userId).apply(addIncome, recreate);
		expect(back.value.booked).toEqual({ minor: 108_340, currency: "USD" });
		expect((await stored(userId))[0]?.amountInUSD.toString()).toBe("1083.4");
	});

	it("plain figures never pass the input, and a forged token is refused", async () => {
		const userId = await usdUser();
		const recreate = await deleted(userId);
		const figures = {
			exchangeRate: "0.000001",
			amountInUSD: "999999",
			units: "999999",
			homeAmount: "999999",
			homeCurrency: "USD",
		};
		expect(
			recreateIncomeSchema.safeParse({
				...recreate,
				date: recreate.date,
				restore: figures,
			}).success,
		).toBe(false);
		const forged = {
			data: JSON.stringify({
				kind: "income.delete",
				id: recreate.id,
				amount: "1000",
				currency: "EUR",
				date: recreate.date,
				home: "USD",
				figures,
			}),
			sig: "0".repeat(64),
		};
		await expect(
			forUser(userId).apply(addIncome, { ...recreate, restore: forged }),
		).rejects.toThrow(refused);
		expect(await stored(userId)).toEqual([]);
	});

	it("a token for another row, or with a changed amount, is refused", async () => {
		const userId = await usdUser();
		const first = await deleted(userId, "First");
		const second = await deleted(userId, "Second");
		await expect(
			forUser(userId).apply(addIncome, {
				...second,
				restore: first.restore,
			}),
		).rejects.toThrow(refused);
		await expect(
			forUser(userId).apply(addIncome, { ...first, amount: "1001" }),
		).rejects.toThrow(refused);
		expect(await stored(userId)).toEqual([]);
	});

	it("another user's token is refused", async () => {
		const owner = await usdUser();
		const recreate = await deleted(owner);
		const other = await usdUser();
		await expect(forUser(other).apply(addIncome, recreate)).rejects.toThrow(
			refused,
		);
		expect(await stored(other)).toEqual([]);
	});

	it("the units go back only into the account and place they were booked into", async () => {
		// ARS home, ARS 1,000 into a cash account: 1,000 units. Its recreate
		// into another account, or with the keep flag flipped, is refused.
		const { user } = await arsUser();
		const wallet = await openAccount(user.id, "Wallet", "CASH", "ARS", 0);
		const other = await openAccount(user.id, "Other", "CASH", "ARS", 0);
		const saved = await forUser(user.id).apply(addIncome, {
			title: "Sale",
			amount: "1000",
			currency: "ARS",
			into: wallet,
		});
		const gone = await forUser(user.id).apply(deleteIncome, {
			expenseId: saved.value.expenseId,
		});
		const recreate = gone.value.recreate;
		await expect(
			forUser(user.id).apply(addIncome, { ...recreate, into: other }),
		).rejects.toThrow(refused);
		await expect(
			forUser(user.id).apply(addIncome, { ...recreate, keep: !recreate.keep }),
		).rejects.toThrow(refused);
		const back = await forUser(user.id).apply(addIncome, recreate);
		expect(back.value.into).toMatchObject({ accountId: wallet });
	});

	it("a token signed under another home currency is refused", async () => {
		const userId = await usdUser();
		const recreate = await deleted(userId);
		await adminDb.user.update({
			where: { id: userId },
			data: { homeCurrency: "EUR" },
		});
		await expect(forUser(userId).apply(addIncome, recreate)).rejects.toThrow(
			refused,
		);
		expect(await stored(userId)).toEqual([]);
	});
});
