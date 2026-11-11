/**
 * Filters on mapped columns and the field encryption epoch (E2EE D11 PR 4.3,
 * plan section 3), on the real clients. Before the epoch every filter runs as
 * it always did. Once `app_settings."fieldEncryptionSince"` is set, every
 * client (scoped or global, whatever its own flag) refuses a call that
 * filters, sorts, groups or aggregates on a mapped column, including
 * Category's compound unique key `name_userId`, before it reaches Postgres.
 * The epoch is read outside transactions; inside one only the cached value
 * is used.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	epochActiveNow,
	resetEpochForTests,
	setEpochReader,
} from "~/server/crypto/epoch";
import { userTransaction } from "~/server/db-tx";
import { readFieldEncryptionEpoch } from "~/server/services/keys/field-encryption-start";
import { adminDb, createTestUser } from "~/test/pg-harness";

type Who = Awaited<ReturnType<typeof createTestUser>>;
let me: Who;
let userId: string;

const setEpoch = (since: Date | null) => adminDb.$executeRaw`
	INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
	VALUES ('app_settings_singleton', now(), ${since})
	ON CONFLICT ("id") DO UPDATE SET "fieldEncryptionSince" = EXCLUDED."fieldEncryptionSince"`;

beforeAll(async () => {
	me = await createTestUser();
	userId = me.user.id;
	const category = await adminDb.category.create({
		data: { userId, name: "Food", color: "teal" },
	});
	await adminDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "Rent",
			amount: "150000",
			currency: "ARS",
			date: new Date("2026-11-02T12:00:00Z"),
			amountInUSD: "100",
			exchangeRate: "1500",
			pricingSource: "MANUAL",
			categoryId: category.id,
		},
	});
});
afterAll(async () => {
	await setEpoch(null);
	resetEpochForTests();
});

const nameKey = () => ({ name_userId: { name: "Food", userId } });

describe("before the epoch", () => {
	it("filters on mapped columns run as before", async () => {
		resetEpochForTests();
		expect(
			await me.db.category.findUnique({
				where: nameKey(),
				select: { id: true },
			}),
		).not.toBeNull();
		expect(await me.db.expense.count({ where: { title: "Rent" } })).toBe(1);
		expect(epochActiveNow()).toBe(false);
	});
});

describe("once the epoch exists", () => {
	beforeAll(async () => {
		await setEpoch(new Date("2026-11-11T00:00:00Z"));
		// Not cached yet: the first refused call reads it from the database.
		resetEpochForTests();
	});

	const calls: [string, () => Promise<unknown>][] = [
		["a where", () => me.db.expense.findMany({ where: { title: "Rent" } })],
		["a count", () => me.db.expense.count({ where: { title: "Rent" } })],
		[
			"findUnique by name_userId",
			() => me.db.category.findUnique({ where: nameKey() }),
		],
		[
			"upsert by name_userId",
			() =>
				me.db.category.upsert({
					where: nameKey(),
					create: { userId, name: "Food", color: "teal" },
					update: {},
				}),
		],
		[
			"a relation filter",
			() => me.db.expense.findMany({ where: { category: { name: "Food" } } }),
		],
		[
			"an orderBy through a relation",
			() => me.db.expense.findMany({ orderBy: { category: { name: "asc" } } }),
		],
		[
			"a nested include filter",
			() =>
				me.db.category.findMany({
					include: { expenses: { where: { title: "Rent" } } },
				}),
		],
		[
			"a groupBy by",
			() => me.db.expense.groupBy({ by: ["title"], _count: { _all: true } }),
		],
		[
			"an aggregate _min",
			() => me.db.expense.aggregate({ _min: { title: true } }),
		],
		[
			"a distinct",
			() =>
				me.db.expense.findMany({ distinct: ["title"], select: { id: true } }),
		],
		[
			"an updateMany",
			() =>
				me.db.expense.updateMany({
					where: { title: "Rent" },
					data: { amount: "1" },
				}),
		],
		[
			"the global client",
			() => adminDb.expense.findMany({ where: { title: "Rent" } }),
		],
	];

	it.each(calls)("refuses %s", async (_label, call) => {
		await expect(call()).rejects.toMatchObject({ code: "filter_on_sealed" });
		expect(epochActiveNow()).toBe(true);
	});

	it("stored nothing for a refused write", async () => {
		const [row] = await adminDb.$queryRaw<{ kept: boolean }[]>`
			SELECT ("amount" = 150000) AS "kept" FROM "expense" WHERE "userId" = ${userId}`;
		expect(row?.kept).toBe(true);
	});

	it("lets calls that name no mapped column through", async () => {
		const rows = await me.db.expense.findMany({
			where: { userId, amount: { gt: 1 } },
			orderBy: [{ date: "desc" }, { id: "desc" }],
			select: { title: true, category: { select: { name: true } } },
		});
		expect(rows).toEqual([{ title: "Rent", category: { name: "Food" } }]);
	});

	it("inside a transaction uses only the epoch its client loaded before it opened", async () => {
		const read = vi.fn(() => readFieldEncryptionEpoch());
		setEpochReader(read);
		resetEpochForTests();
		try {
			await userTransaction(me.db, userId, async (tx) => {
				const loaded = read.mock.calls.length;
				expect(loaded).toBe(1);
				await expect(
					tx.expense.findMany({ where: { title: "Rent" } }),
				).rejects.toMatchObject({ code: "filter_on_sealed" });
				// A cache forgotten mid-transaction is not reloaded there.
				resetEpochForTests();
				expect(await tx.expense.count({ where: { title: "Rent" } })).toBe(1);
				expect(read.mock.calls.length).toBe(loaded);
			});
		} finally {
			setEpochReader(() => readFieldEncryptionEpoch());
		}
	});
});
