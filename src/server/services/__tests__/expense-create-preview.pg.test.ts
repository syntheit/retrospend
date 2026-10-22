/**
 * expense.create through the preview framework on a real Postgres: preview
 * reports the change to `spent` and writes nothing; apply writes the same
 * expense and reports the same change (preview = result, I22).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { expenseData } from "./spending-fixture";

const usd = (minor: number) => ({ minor, currency: "USD" });

async function userWithLunch() {
	const { user } = await createTestUser();
	// USD 10.00 already spent this month.
	await adminDb.expense.create({
		data: expenseData(user.id, {
			title: "Lunch",
			amount: 10,
			currency: "USD",
			date: new Date(),
		}),
	});
	return user.id;
}

const input = (date: Date) => ({
	id: randomUUID(),
	title: "Books",
	amount: 12.34,
	currency: "USD",
	date,
});

describe("expense.create preview", () => {
	it("shows the change to spent and writes nothing", async () => {
		const userId = await userWithLunch();
		const books = input(new Date());

		const preview = await forUser(userId).preview(createExpense, books);

		expect(preview.changes).toEqual([
			{
				id: "spent",
				currency: "USD",
				before: usd(1_000),
				after: usd(2_234),
				delta: usd(1_234),
				figureAfter: [usd(2_234)],
			},
		]);
		expect(preview.value).toMatchObject({ id: books.id, direction: "OUT" });
		await expect(
			adminDb.expense.findUnique({ where: { id: books.id } }),
		).resolves.toBeNull();
	});

	it("applies exactly what it previewed", async () => {
		const userId = await userWithLunch();
		const books = input(new Date());
		const runner = forUser(userId);

		const preview = await runner.preview(createExpense, books);
		const applied = await runner.apply(createExpense, books);

		expect(applied.changes).toEqual(preview.changes);
		expect(applied.undo).toEqual({
			kind: "revert",
			mutation: "expense.create",
			rows: [{ table: "expense", id: books.id }],
		});
		const saved = await adminDb.expense.findUnique({ where: { id: books.id } });
		expect(saved?.amount.toString()).toBe("12.34");
		expect(saved?.userId).toBe(userId);
	});

	it("reports spent unchanged for an expense outside this month", async () => {
		const userId = await userWithLunch();
		const lastYear = new Date();
		lastYear.setFullYear(lastYear.getFullYear() - 1);

		const preview = await forUser(userId).preview(
			createExpense,
			input(lastYear),
		);

		expect(preview.changes).toEqual([]);
		expect(preview.unchanged).toEqual([{ id: "spent", value: [usd(1_000)] }]);
	});

	it("refuses an income category", async () => {
		const { user } = await createTestUser();
		const salary = await adminDb.category.create({
			data: {
				name: "Salary",
				color: "emerald",
				kind: "INCOME",
				userId: user.id,
			},
		});

		await expect(
			forUser(user.id).preview(createExpense, {
				...input(new Date()),
				categoryId: salary.id,
			}),
		).rejects.toThrow("Category not found");
	});
});
