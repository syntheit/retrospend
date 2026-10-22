/**
 * The money_in migration (M1) on a real Postgres: it reapplies cleanly, its
 * CHECK keeps money in from looking like spending, income categories seed
 * once even when two requests race, and the budget spending filter follows
 * the amortization mode through the parent relation (which the in-memory
 * table in spent.test.ts cannot follow).
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import {
	ensureIncomeCategories,
	INCOME_CATEGORIES,
} from "~/server/services/expense.service";
import { spentIn } from "~/server/services/figures/spent";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { at, expenseData } from "./spending-fixture";

const MIGRATIONS = fileURLToPath(
	new URL("../../../../prisma/migrations/", import.meta.url),
);

/** Found by suffix: the timestamp is a placeholder until merge. */
function moneyInSql(): string {
	const folder = readdirSync(MIGRATIONS).find((name) =>
		name.endsWith("_money_in"),
	);
	if (!folder) throw new Error("money_in migration folder not found");
	return readFileSync(`${MIGRATIONS}${folder}/migration.sql`, "utf8");
}

describe("money_in migration", () => {
	it("applies a second time without error or change", async () => {
		const { user } = await createTestUser();
		await adminDb.expense.create({
			data: expenseData(user.id, {
				title: "Before",
				amount: 10,
				date: at("2026-03-01"),
			}),
		});
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await client.query(moneyInSql());
		} finally {
			await client.end();
		}
		await expect(
			adminDb.expense.findFirst({
				where: { userId: user.id },
				select: {
					direction: true,
					entryKind: true,
					inType: true,
					amortizeMode: true,
				},
			}),
		).resolves.toEqual({
			direction: "OUT",
			entryKind: "STANDARD",
			inType: null,
			amortizeMode: "INSTALLMENTS",
		});
	});

	it("gives existing categories and templates the spending defaults", async () => {
		const { user } = await createTestUser();
		await adminDb.category.create({
			data: { name: "Groceries", color: "emerald", userId: user.id },
		});
		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "Gym",
				amount: "0.00012345",
				currency: "BTC",
				frequency: "MONTHLY",
				nextDueDate: at("2026-05-01"),
			},
		});
		await expect(
			adminDb.category.findMany({
				where: { userId: user.id },
				select: { kind: true },
			}),
		).resolves.toEqual([{ kind: "EXPENSE" }]);
		expect(template).toMatchObject({ direction: "OUT", amountMode: "FIXED" });
		// The widened amount keeps 8 decimals, like expense.amount.
		expect(template.amount.toString()).toBe("0.00012345");
	});

	describe("expense_in_type_check", () => {
		let userId: string;
		beforeAll(async () => {
			userId = (await createTestUser()).user.id;
		});
		const insert = (row: Parameters<typeof expenseData>[1]) =>
			adminDb.expense.create({ data: expenseData(userId, row) });
		const base = { title: "Row", amount: 1, date: at("2026-03-01") };

		it("rejects money in without a type", async () => {
			await expect(insert({ ...base, direction: "IN" })).rejects.toThrow(
				/expense_in_type_check/,
			);
		});

		it("rejects a type on spending or on a non-standard entry", async () => {
			await expect(insert({ ...base, inType: "REFUND" })).rejects.toThrow(
				/expense_in_type_check/,
			);
			await expect(
				insert({
					...base,
					direction: "IN",
					entryKind: "STARTING_BALANCE",
					inType: "INCOME",
				}),
			).rejects.toThrow(/expense_in_type_check/);
		});

		it("accepts every kind the spec names", async () => {
			await insert({ ...base, direction: "IN", inType: "INCOME" });
			await insert({ ...base, direction: "IN", inType: "REFUND" });
			await insert({ ...base, direction: "IN", entryKind: "STARTING_BALANCE" });
			await insert({ ...base, entryKind: "ADJUSTMENT" });
			await insert({ ...base, direction: "IN", entryKind: "NOT_SPENDING" });
		});
	});
});

describe("ensureIncomeCategories", () => {
	it("seeds the income categories once under RLS, even when two calls race", async () => {
		const { user, db } = await createTestUser();
		const [first, second] = await Promise.all([
			ensureIncomeCategories(db, user.id),
			ensureIncomeCategories(db, user.id),
		]);

		const names = INCOME_CATEGORIES.map((c) => c.name).sort();
		expect(first.map((c) => c.name)).toEqual(names);
		expect(second.map((c) => c.name)).toEqual(names);
		await expect(
			adminDb.category.count({ where: { userId: user.id, kind: "INCOME" } }),
		).resolves.toBe(INCOME_CATEGORIES.length);
	});

	it("leaves an expense category with an income name alone", async () => {
		const { user, db } = await createTestUser();
		await adminDb.category.create({
			data: { name: "Gifts", color: "rose", userId: user.id },
		});

		const income = await ensureIncomeCategories(db, user.id);

		expect(income.map((c) => c.name)).not.toContain("Gifts");
		await expect(
			adminDb.category.findFirst({ where: { userId: user.id, name: "Gifts" } }),
		).resolves.toMatchObject({ kind: "EXPENSE", color: "rose" });
	});
});

describe("budget and report spending by amortization mode", () => {
	const MARCH = {
		gte: new Date("2026-03-01T00:00:00.000Z"),
		lte: new Date("2026-03-31T23:59:59.999Z"),
	};

	it("counts parts or the full purchase as the mode says, and hidden rows only for the budget", async () => {
		const { user, db } = await createTestUser();
		const userId = user.id;
		const laptop = randomUUID();
		const phone = randomUUID();
		const part = (parentId: string, amount: number, day: string) =>
			expenseData(userId, {
				title: "Part",
				amount,
				date: at(day),
				isAmortizedChild: true,
				parentId,
			});
		await adminDb.expense.createMany({
			data: [
				expenseData(userId, {
					id: laptop,
					title: "Laptop",
					amount: 120_000,
					date: at("2026-02-15"),
					isAmortizedParent: true,
				}),
				expenseData(userId, {
					id: phone,
					title: "Phone",
					amount: 90_000,
					date: at("2026-03-03"),
					isAmortizedParent: true,
					amortizeMode: "REPORTS_ONLY",
				}),
				expenseData(userId, {
					title: "Hidden",
					amount: 7_000,
					date: at("2026-03-12"),
					excludeFromAnalytics: true,
				}),
				expenseData(userId, {
					title: "Hidden refund",
					amount: 1_000,
					date: at("2026-03-13"),
					excludeFromAnalytics: true,
					direction: "IN",
					inType: "REFUND",
				}),
			],
		});
		await adminDb.expense.createMany({
			data: [
				part(laptop, 40_000, "2026-02-15"),
				part(laptop, 40_000, "2026-03-15"),
				part(phone, 30_000, "2026-03-03"),
				part(phone, 30_000, "2026-04-03"),
			],
		});

		const march = (basis: "report" | "budget") =>
			spentIn(db, { userId, date: MARCH, basis }, "ARS", 1000);

		// Reports spread both purchases: laptop part 40,000 + phone part 30,000.
		await expect(march("report")).resolves.toBe(70_000);
		// Budget: laptop part 40,000 + the phone in full 90,000 + hidden 7,000 - hidden refund 1,000.
		await expect(march("budget")).resolves.toBe(136_000);
	});

	it("never counts a row filed under an income category", async () => {
		const { user, db } = await createTestUser();
		const [salary] = await ensureIncomeCategories(db, user.id).then((all) =>
			all.filter((c) => c.name === "Salary"),
		);
		await adminDb.expense.createMany({
			data: [
				expenseData(user.id, {
					title: "Lunch",
					amount: 5_000,
					date: at("2026-03-02"),
				}),
				// An OUT row in an income category, as a CSV import could make.
				expenseData(user.id, {
					title: "Payroll fee",
					amount: 800,
					date: at("2026-03-02"),
					categoryId: salary?.id,
				}),
			],
		});

		for (const basis of ["report", "budget"] as const) {
			await expect(
				spentIn(db, { userId: user.id, date: MARCH, basis }, "ARS", 1000),
			).resolves.toBe(5_000);
		}
	});
});
