/**
 * The Add expense preview reads spending in the home currency too, so the
 * sheet can lead with the figure the save books. Hand-derived, ARS home:
 *
 *   EUR 1,000 at a typed 1,234.567890123 = ARS 1,234,567.89 (home amount
 *   1,234,567.890123, half-even at 2 places), so the spent change is
 *   +EUR 1,000.00 (100,000 minor) and the home spending change is
 *   +ARS 1,234,567.89 (123,456,789 minor), the booked home amount.
 *   An ARS expense of 5,000 changes both by the same 500,000 minor.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { createExpense } from "../expense-create.mutation";
import { type ExpenseForm, expenseFormSchema, toExpenseInput } from "./input";

beforeAll(seedArsRates);

async function form(over: Partial<ExpenseForm>) {
	const { user } = await arsUser();
	const c = await fixtureDb.category.create({
		data: { userId: user.id, name: "Travel", color: "teal", kind: "EXPENSE" },
	});
	const id = crypto.randomUUID();
	const input = toExpenseInput(
		expenseFormSchema.parse({
			id,
			title: "Hotel",
			amount: "1000",
			currency: "EUR",
			date: isoDay(TODAY),
			categoryId: c.id,
			...over,
		}),
		"UTC",
	);
	return { userId: user.id, id, input };
}

const change = (
	p: { changes: readonly { id: string; delta: { minor: number } }[] },
	id: string,
) => p.changes.find((c) => c.id === id);

describe("expense preview: spending in the home currency", () => {
	it("a euro expense: home change first-class, equal to what is booked", async () => {
		const { userId, id, input } = await form({ customRate: "1234.567890123" });
		const preview = await forUser(userId).preview(createExpense, input);
		expect(change(preview, "spent")).toMatchObject({
			currency: "EUR",
			delta: { minor: 100_000 },
		});
		expect(change(preview, "glance.spent")).toMatchObject({
			currency: "ARS",
			delta: { minor: 123_456_789 },
		});
		await forUser(userId).apply(createExpense, input);
		const row = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
		expect(row.homeCurrency).toBe("ARS");
		expect(row.homeAmount?.toString()).toBe("1234567.89");
	});

	it("a home-currency expense changes both figures by the same amount", async () => {
		const { userId, input } = await form({
			amount: "5000",
			currency: "ARS",
		});
		const preview = await forUser(userId).preview(createExpense, input);
		expect(change(preview, "spent")?.delta.minor).toBe(500_000);
		expect(change(preview, "glance.spent")?.delta.minor).toBe(500_000);
	});
});
