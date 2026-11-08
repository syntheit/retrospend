/**
 * Raw SQL and the array `$transaction` are refused on a user-scoped client
 * (they would run on the owner connection, with no role and no RLS), and the
 * sites that used to rely on that now read the same rows another way:
 * getFilterOptions in a user transaction, the exchange-rate reads on the
 * global client, the username change in a user transaction.
 */
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	listCurrencies,
	listLatestRates,
} from "~/server/services/exchange-rate.service";
import { ExpenseService } from "~/server/services/expense.service";
import { validateAndProcessUsernameChange } from "~/server/services/username.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

const REFUSED = [
	"$queryRaw",
	"$executeRaw",
	"$queryRawUnsafe",
	"$executeRawUnsafe",
	"$queryRawTyped",
	"$executeRawTyped",
] as const;

type Methods = Record<string, (...args: unknown[]) => unknown>;

describe("a user-scoped client", () => {
	it.each(REFUSED)("refuses %s and points at userTransaction", async (name) => {
		const { db } = await createTestUser();
		const method = (db as unknown as Methods)[name];
		expect(() => method?.("SELECT 1")).toThrow(/userTransaction/);
		expect(() => method?.("SELECT 1")).toThrow(name);
	});

	it.each(["$parent", "$extends", "$connect", "$disconnect", "$on"])(
		"gives no way back to the owner client through %s",
		async (name) => {
			const { db } = await createTestUser();
			expect(() => (db as unknown as Methods)[name]).toThrow(name);
		},
	);

	it("refuses a tagged-template raw query too", async () => {
		const { db } = await createTestUser();
		expect(() => db.$queryRaw`SELECT 1`).toThrow(/userTransaction/);
	});

	it("refuses the array form of $transaction, even when it holds model calls", async () => {
		const { user, db } = await createTestUser();
		expect(() =>
			db.$transaction([db.category.findMany({ where: { userId: user.id } })]),
		).toThrow(/userTransaction/);
	});

	it("still runs a transaction callback, with model calls", async () => {
		const { user, db } = await createTestUser();
		const found = await db.$transaction((tx) =>
			tx.user.findUnique({ where: { id: user.id }, select: { id: true } }),
		);
		expect(found?.id).toBe(user.id);
	});

	it("runs raw SQL in userTransaction as retrospend_app for that user", async () => {
		const { user, db } = await createTestUser();
		const [row] = await userTransaction(
			db,
			user.id,
			(tx) =>
				tx.$queryRaw<{ role: string; uid: string }[]>`
					SELECT current_user AS role,
					       current_setting('app.current_user_id') AS uid`,
		);
		expect(row).toEqual({ role: "retrospend_app", uid: user.id });
	});
});

describe("getFilterOptions", () => {
	it("returns the user's years newest first and their categories by name, no one else's", async () => {
		const me = await createTestUser();
		const other = await createTestUser();
		const food = await adminDb.category.create({
			data: { name: "Food", color: "blue", userId: me.user.id },
		});
		const bills = await adminDb.category.create({
			data: { name: "Bills", color: "pink", userId: me.user.id },
		});
		await adminDb.category.create({
			data: { name: "Theirs", color: "red", userId: other.user.id },
		});
		const expense = (userId: string, date: string) => ({
			userId,
			title: "x",
			amount: "10",
			currency: "USD",
			date: new Date(date),
			amountInUSD: "10",
			exchangeRate: "1",
			pricingSource: "MANUAL",
		});
		await adminDb.expense.createMany({
			data: [
				expense(me.user.id, "2024-06-15T12:00:00Z"),
				expense(me.user.id, "2025-03-05T12:00:00Z"),
				expense(me.user.id, "2025-09-05T12:00:00Z"),
				expense(other.user.id, "2023-01-10T12:00:00Z"),
			],
		});

		const options = await new ExpenseService(me.db).getFilterOptions(
			me.user.id,
		);

		expect(options).toEqual({
			years: [2025, 2024],
			categories: [
				{ id: bills.id, name: "Bills", color: "pink", usageCount: 0 },
				{ id: food.id, name: "Food", color: "blue", usageCount: 0 },
			],
		});
	});
});

describe("exchange-rate raw reads", () => {
	const rate = (
		currency: string,
		type: string,
		date: string,
		value: string,
	) => ({ currency, type, date: new Date(date), rate: value });

	it("listLatestRates and listCurrencies read the global rows", async () => {
		await adminDb.exchangeRate.createMany({
			data: [
				rate("ARS", "official", "2026-10-01T00:00:00Z", "1000"),
				rate("ARS", "official", "2026-10-02T00:00:00Z", "1010"),
				rate("ARS", "blue", "2026-10-02T00:00:00Z", "1500.5"),
				rate("EUR", "official", "2026-10-02T00:00:00Z", "0.9"),
			],
		});

		const latest = await listLatestRates({ take: 10 });
		expect(latest.map((r) => [r.currency, r.type, r.rate])).toEqual([
			["ARS", "blue", "1500.5"],
			["ARS", "official", "1010"],
			["EUR", "official", "0.9"],
		]);

		const early = await listLatestRates({
			onOrBefore: new Date("2026-10-01T23:59:59.999Z"),
			take: 10,
		});
		expect(early.map((r) => [r.currency, r.type, r.rate])).toEqual([
			["ARS", "official", "1000"],
		]);

		const currencies = await listCurrencies({ take: 1000 });
		const typesOf = (code: string) =>
			currencies.find((c) => c.code === code)?.rateTypes;
		expect(typesOf("ARS")).toEqual(["blue", "official"]);
		expect(typesOf("EUR")).toEqual(["official"]);
		expect(typesOf("USD")).toEqual([]);
	});
});

describe("username change", () => {
	it("records the old name, frees a stale reservation of it and stamps the cooldown", async () => {
		const me = await createTestUser();
		const other = await createTestUser();
		const current = me.user.username;
		// Another user once held this name and left it: a stale history row.
		await adminDb.usernameHistory.create({
			data: { userId: other.user.id, previousUsername: current },
		});

		await validateAndProcessUsernameChange(
			me.db,
			me.user.id,
			current,
			`${current}_new`,
		);

		const history = await adminDb.usernameHistory.findMany({
			where: { previousUsername: current },
		});
		expect(history.map((h) => h.userId)).toEqual([me.user.id]);
		const after = await adminDb.user.findUniqueOrThrow({
			where: { id: me.user.id },
			select: { lastUsernameChangeAt: true },
		});
		expect(after.lastUsernameChangeAt).toBeInstanceOf(Date);
	});
});
