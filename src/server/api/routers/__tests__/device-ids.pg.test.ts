/**
 * The web's flows on a category or an account a device made. A device names
 * a row it creates offline with a client UUID; the web's inputs used to take
 * a cuid only, so it could not read, edit or use such a row. Each test below
 * makes the row with a UUID id (what the phone's outbox writes), then runs
 * the web procedure on it. Reverting an input to `z.cuid()` makes the test
 * for that flow throw a zod error.
 *
 * Hand-derived (ARS home, today's Blue rate 1,468 per USD):
 *   - USD 10.00 is ARS 14,680.00 and USD 20.00 is ARS 29,360.00.
 *   - Merging "Cafe" into "Food" moves its two expenses, so Food holds 3
 *     (one it had, two it got) and Cafe is gone.
 *   - An account created at 100 and updated to 120 holds 120.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import { fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

async function setup() {
	const who = await arsUser();
	const userId = who.user.id;
	const caller = createCallerFactory(appRouter)({
		session: makeSession({ id: userId }),
		db: who.db,
		headers: new Headers(),
	});
	const category = (name: string) =>
		fixtureDb.category.create({
			data: {
				id: randomUUID(),
				userId,
				name,
				color: "teal",
				kind: "EXPENSE",
			},
		});
	const account = (balance = "100") =>
		fixtureDb.assetAccount.create({
			data: {
				id: randomUUID(),
				userId,
				name: "Device cash",
				type: "CASH",
				currency: "ARS",
				balance,
				isLiquid: true,
			},
		});
	return { caller, userId, category, account };
}

const expenseForm = (categoryId: string, amount = "10.00") => ({
	id: randomUUID(),
	title: "Hotel",
	amount,
	currency: "USD",
	date: isoDay(TODAY),
	categoryId,
});

const homeAmount = async (id: string) =>
	(
		await fixtureDb.expense.findUniqueOrThrow({
			where: { id },
			select: { homeAmount: true, categoryId: true },
		})
	).homeAmount?.toFixed(2);

describe("an expense under a device's category", () => {
	it("the composer creates and edits it", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const form = expenseForm(food.id);
		await caller.entry.expense.create.save(form);
		expect(await homeAmount(form.id)).toBe("14680.00");

		const other = await category("Travel");
		await caller.entry.expense.update.save({
			...form,
			amount: "20.00",
			categoryId: other.id,
		});
		expect(await homeAmount(form.id)).toBe("29360.00");
		const row = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: form.id },
		});
		expect(row.categoryId).toBe(other.id);
	});

	it("the old expense form creates and edits it", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const input = {
			id: randomUUID(),
			title: "Hotel",
			amount: 10,
			currency: "USD",
			date: TODAY,
			categoryId: food.id,
		};
		await caller.expense.createExpense(input);
		expect(await homeAmount(input.id)).toBe("14680.00");
		const other = await category("Travel");
		await caller.expense.updateExpense({
			...input,
			amount: 20,
			categoryId: other.id,
		});
		expect(await homeAmount(input.id)).toBe("29360.00");
	});

	it("a shared expense takes it, from the composer and the old form", async () => {
		const { caller, userId, category } = await setup();
		const food = await category("Food");
		const me = { participantType: "user" as const, participantId: userId };
		const made = await caller.sharedTransaction.create({
			amount: 30,
			currency: "ARS",
			description: "Dinner",
			categoryId: food.id,
			date: TODAY,
			paidBy: me,
			splitWith: [me],
			splitMode: "EQUAL",
		});
		expect(
			(
				await fixtureDb.sharedTransaction.findUniqueOrThrow({
					where: { id: made.transaction.id },
				})
			).categoryId,
		).toBe(food.id);

		const other = await category("Travel");
		await caller.sharedTransaction.update({
			id: made.transaction.id,
			categoryId: other.id,
		});
		expect(
			(
				await fixtureDb.sharedTransaction.findUniqueOrThrow({
					where: { id: made.transaction.id },
				})
			).categoryId,
		).toBe(other.id);

		const id = randomUUID();
		await caller.entry.shared.create.save({
			id,
			amount: "30",
			currency: "ARS",
			description: "Lunch",
			categoryId: food.id,
			date: isoDay(TODAY),
			paidBy: me,
			splitWith: [me],
			splitMode: "EQUAL",
		});
		expect(
			(await fixtureDb.sharedTransaction.findUniqueOrThrow({ where: { id } }))
				.categoryId,
		).toBe(food.id);
	});

	it("a recurring template takes it on create and on edit", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const made = await caller.recurring.create({
			name: "Rent",
			amount: 100,
			currency: "ARS",
			categoryId: food.id,
			frequency: "MONTHLY",
			nextDueDate: TODAY,
		});
		expect(made.categoryId).toBe(food.id);
		const other = await category("Travel");
		const edited = await caller.recurring.update({
			id: made.id,
			categoryId: other.id,
		});
		expect(edited.categoryId).toBe(other.id);
	});

	it("an analytics preference is set and cleared", async () => {
		const { caller, userId, category } = await setup();
		const food = await category("Food");
		await caller.preferences.updateAnalyticsCategoryPreference({
			categoryId: food.id,
			isFlexible: true,
		});
		const where = { userId, categoryId: food.id };
		expect(
			(
				await fixtureDb.analyticsCategoryPreference.findFirstOrThrow({ where })
			).isFlexible,
		).toBe(true);
		await caller.preferences.deleteAnalyticsCategoryPreference({
			categoryId: food.id,
		});
		expect(await fixtureDb.analyticsCategoryPreference.count({ where })).toBe(
			0,
		);
	});
});

describe("a device's category in the categories sheet", () => {
	it("is edited by id", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const edited = await caller.categories.update({
			id: food.id,
			name: "Groceries",
			color: "blue",
		});
		expect(edited).toMatchObject({ id: food.id, name: "Groceries" });
	});

	it("is merged into another, and the merge undone", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const cafe = await category("Cafe");
		const rows = [food, cafe, cafe];
		const ids: string[] = [];
		for (const row of rows) {
			const form = expenseForm(row.id);
			ids.push(form.id);
			await caller.entry.expense.create.save(form);
		}
		const preview = await caller.categories.previewRemove({
			id: cafe.id,
			targetId: food.id,
		});
		expect(preview).toBeTruthy();
		const done = await caller.categories.remove({
			id: cafe.id,
			targetId: food.id,
		});
		expect(
			await fixtureDb.expense.count({ where: { categoryId: food.id } }),
		).toBe(3);
		expect(await fixtureDb.category.count({ where: { id: cafe.id } })).toBe(0);

		await caller.categories.restore({ stash: done.value.stash });
		expect(
			await fixtureDb.expense.count({ where: { categoryId: cafe.id } }),
		).toBe(2);
	});

	it("is deleted with its expenses left uncategorized", async () => {
		const { caller, category } = await setup();
		const food = await category("Food");
		const form = expenseForm(food.id);
		await caller.entry.expense.create.save(form);
		await caller.categories.remove({ id: food.id, targetId: null });
		const row = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: form.id },
		});
		expect(row.categoryId).toBeNull();
	});
});

describe("a device's account on the web", () => {
	const stored = (id: string) =>
		fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });

	it("is edited", async () => {
		const { caller, account } = await setup();
		const made = await account();
		await caller.wealth.updateAsset({
			id: made.id,
			name: "Wallet",
			type: "CASH",
			currency: "ARS",
			balance: 100,
			isLiquid: true,
		});
		expect((await stored(made.id)).name).toBe("Wallet");
	});

	it("gets its icon changed", async () => {
		const { caller, account } = await setup();
		const made = await account();
		await caller.wealth.setAssetIcon({
			id: made.id,
			icon: { kind: "MONOGRAM", value: "avatar-3" },
		});
		expect(await stored(made.id)).toMatchObject({
			iconKind: "MONOGRAM",
			iconValue: "avatar-3",
		});
	});

	it("has its balance updated", async () => {
		const { caller, account } = await setup();
		const made = await account("100");
		await caller.wealth.updateAssetBalance({
			assetId: made.id,
			newBalance: 120,
		});
		expect((await stored(made.id)).balance.toString()).toBe("120");
	});

	it("is closed, reopened and deleted by id", async () => {
		const { caller, account } = await setup();
		const made = await account();
		await caller.wealth.closeAsset({ id: made.id });
		expect((await stored(made.id)).closedAt).not.toBeNull();
		await caller.wealth.reopenAsset({ id: made.id });
		expect((await stored(made.id)).closedAt).toBeNull();
		await caller.wealth.deleteAssetPermanently({ id: made.id });
		expect(
			await fixtureDb.assetAccount.count({ where: { id: made.id } }),
		).toBe(0);
	});
});
