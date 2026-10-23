/**
 * Add income books its rate through bookRate, as Add expense does: a typed
 * rate, a pair with no table rate, and the undo. USD home; hand-derived:
 *
 * - EUR 1,000 at a typed 1 EUR = 1.0834 USD books USD 1,083.40
 *   (1,000 x 1.0834), rate type Custom, home rate 1.0834 kept to 12 decimals.
 * - UYU has no rate: income in UYU is refused (never booked at 1) until a
 *   rate is typed; UYU 5,000 at 0.025 books USD 125.00.
 * - Deleting it and taking the delete back restores the same booked leg.
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { type AddIncomeInput, addIncome } from "./add.mutation";
import { deleteIncome } from "./delete.mutation";

async function usdUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "USD" },
	});
	return user.id;
}

const row = (id: string) =>
	adminDb.expense.findUniqueOrThrow({
		where: { id },
		select: {
			rateType: true,
			homeCurrency: true,
			homeRate: true,
			homeAmount: true,
		},
	});

const euroInvoice: AddIncomeInput = {
	title: "Client in Lisbon",
	amount: "1000",
	currency: "EUR",
	customRate: "1.0834",
};

describe("income.add with a typed rate", () => {
	it("EUR 1,000 at 1.0834 books USD 1,083.40, the preview first", async () => {
		const userId = await usdUser();
		const preview = await forUser(userId).preview(addIncome, euroInvoice);
		expect(preview.value.booked).toEqual({ minor: 108_340, currency: "USD" });

		const saved = await forUser(userId).apply(addIncome, euroInvoice);
		expect(saved.value.booked).toEqual({ minor: 108_340, currency: "USD" });
		const r = await row(saved.value.expenseId);
		expect(r.rateType).toBe("custom");
		expect(r.homeCurrency).toBe("USD");
		expect(r.homeRate?.toString()).toBe("1.0834");
		expect(r.homeAmount?.toString()).toBe("1083.4");
	});

	it("a pair with no rate is refused until a rate is typed", async () => {
		const userId = await usdUser();
		const uyu: AddIncomeInput = {
			title: "Feria",
			amount: "5000",
			currency: "UYU",
		};
		await expect(forUser(userId).apply(addIncome, uyu)).rejects.toThrow();
		expect(
			await adminDb.expense.count({ where: { userId, title: "Feria" } }),
		).toBe(0);

		const typed = await forUser(userId).apply(addIncome, {
			...uyu,
			customRate: "0.025",
		});
		expect(typed.value.booked).toEqual({ minor: 12_500, currency: "USD" });
	});

	it("taking a delete back restores the same booked leg", async () => {
		const userId = await usdUser();
		const saved = await forUser(userId).apply(addIncome, euroInvoice);
		const before = await row(saved.value.expenseId);
		const deleted = await forUser(userId).apply(deleteIncome, {
			expenseId: saved.value.expenseId,
		});
		const back = await forUser(userId).apply(addIncome, deleted.value.recreate);
		expect(back.value.expenseId).toBe(saved.value.expenseId);
		expect(back.value.booked).toEqual({ minor: 108_340, currency: "USD" });
		expect(await row(saved.value.expenseId)).toEqual(before);
	});
});
