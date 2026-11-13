/**
 * Amortization on real Postgres in an ARS home (blue, 1 USD = 1545): the
 * parts are written as exact text and add up to the parent to the cent, in
 * the expense's currency, in USD and in the booked home value.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { ExpenseService } from "./expense.service";

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);

beforeAll(async () => {
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: today, currency: "ARS", type: "blue" },
		},
		create: { date: today, currency: "ARS", type: "blue", rate: "1545" },
		update: { rate: "1545" },
	});
});

describe("amortization on a booked expense", () => {
	it("ARS 1,000,000.01 over 7 months adds up to the principal exactly", async () => {
		const u = await createTestUser();
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
		const category = await adminDb.category.create({
			data: { userId: u.user.id, name: "Rent", color: "teal" },
		});
		const parent = await new ExpenseService(u.db).createExpense(u.user.id, {
			title: "Sofa",
			amount: "1000000.01",
			currency: "ARS",
			date: today,
			categoryId: category.id,
			amortizeOver: 7,
		} as never);
		const parts = await adminDb.expense.findMany({
			where: { parentId: parent.id },
			orderBy: { date: "asc" },
		});
		expect(parts).toHaveLength(7);
		// 100000001 centavos = 14285714 x 7 + 3: the first three parts take a
		// centavo, 142857.15 three times and 142857.14 four times.
		expect(parts.map((p) => p.amount.toFixed(2))).toEqual([
			"142857.15",
			"142857.15",
			"142857.15",
			"142857.14",
			"142857.14",
			"142857.14",
			"142857.14",
		]);
		const centavos = parts.reduce(
			(sum, p) => sum + BigInt(p.amount.toFixed(2).replace(".", "")),
			0n,
		);
		expect(centavos).toBe(100_000_001n);
		const cents = (value: { toFixed(places: number): string }) =>
			BigInt(value.toFixed(2).replace(".", ""));
		const sum = (pick: (p: (typeof parts)[number]) => bigint) =>
			parts.reduce((total, p) => total + pick(p), 0n);
		expect(sum((p) => cents(p.amountInUSD))).toBe(cents(parent.amountInUSD));
		expect(parent.homeAmount).not.toBeNull();
		expect(sum((p) => cents(p.homeAmount ?? p.amount))).toBe(
			cents(parent.homeAmount ?? parent.amount),
		);
	});
});
