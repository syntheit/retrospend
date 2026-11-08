/**
 * Category name blind index (E2EE lane D9), on real Postgres. Hand-derived
 * expectations:
 *
 *   same name, two users               -> two different indexes
 *   "Food" twice for one user          -> CONFLICT "Category name already exists"
 *   "Food" then "Food " (edge space)   -> CONFLICT (trimmed, as the app always did)
 *   "Food" then "food"                 -> both allowed (compared exactly, as today)
 *   rename B to A's name               -> CONFLICT; rename to a free name -> new index
 *   two creates of one name at once    -> one row, one CONFLICT
 *   no master key                      -> nameIndex null, names still unique by name
 *   backfill, 3 rows with no index     -> 3 updated, then 0 updated
 *   rows "Food" and "Food "            -> 1 updated, 1 conflict, one stays null
 *   another user's session             -> its keyring gives a different index
 *   no signed-in user                  -> no key, no index
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { Keyring } from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	type CategoryWriteOptions,
	createCategory,
	updateCategory,
} from "../category.service";
import {
	backfillCategoryNameIndexes,
	backfillCategoryNameIndexForUser,
	categoryNameIndexFor,
	computeCategoryNameIndex,
} from "../category-name-index.service";
import { DataKeyError, getOrCreateDataKeyring } from "../keys/data-key.service";

const master = new Keyring([{ id: 1, key: randomBytes(32) }]);
const withKey = { masterKeyring: master };
const input = (name: string) => ({ name, color: "orange" as const });

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const indexOf = async (id: string) =>
	(
		await adminDb.category.findUniqueOrThrow({
			where: { id },
			select: { nameIndex: true },
		})
	).nameIndex;

const CONFLICT = {
	code: "CONFLICT",
	message: "Category name already exists",
};

const create = (
	who: TestUser,
	name: string,
	options: CategoryWriteOptions = withKey,
) => createCategory(who.db, who.user.id, input(name), options);

describe("category name index", () => {
	it("gives the same name different indexes for two users", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const rowA = await create(a, "Food");
		const rowB = await create(b, "Food");
		const [ia, ib] = [await indexOf(rowA.id), await indexOf(rowB.id)];
		expect(ia).toMatch(/^[0-9a-f]{64}$/);
		expect(ib).toMatch(/^[0-9a-f]{64}$/);
		expect(ia).not.toBe(ib);
		// Each is the hash under that user's own key, and not the other's.
		const keyA = await a.db.$transaction((tx) =>
			getOrCreateDataKeyring(tx, master),
		);
		expect(ia).toBe(computeCategoryNameIndex(keyA, "Food"));
		expect(ib).not.toBe(computeCategoryNameIndex(keyA, "Food"));
	});

	it("refuses a duplicate name with the error it always gave", async () => {
		const a = await createTestUser();
		await create(a, "Food");
		await expect(create(a, "Food")).rejects.toMatchObject(CONFLICT);
		await expect(create(a, "Food ")).rejects.toMatchObject(CONFLICT);
		await expect(create(a, "Food")).rejects.toBeInstanceOf(TRPCError);
		expect(await adminDb.category.count({ where: { userId: a.user.id } })).toBe(
			1,
		);
	});

	it("compares names exactly apart from edge spaces: food and Food coexist", async () => {
		const a = await createTestUser();
		await create(a, "Food");
		await create(a, "food");
		expect(await adminDb.category.count({ where: { userId: a.user.id } })).toBe(
			2,
		);
		const upper = await create(a, "FOOD");
		// Renaming "food" to "Food" is refused: that exact name exists.
		const lower = await adminDb.category.findFirstOrThrow({
			where: { userId: a.user.id, name: "food" },
		});
		await expect(
			updateCategory(a.db, a.user.id, lower.id, { name: "Food" }, withKey),
		).rejects.toMatchObject(CONFLICT);
		// Renaming "FOOD" to "FOOD " is its own name, so it is allowed.
		const same = await updateCategory(
			a.db,
			a.user.id,
			upper.id,
			{ name: "FOOD " },
			withKey,
		);
		expect(same.name).toBe("FOOD ");
	});

	it("refuses a rename to an existing name and indexes a free one", async () => {
		const a = await createTestUser();
		await create(a, "Food");
		const rent = await create(a, "Rent");
		await expect(
			updateCategory(a.db, a.user.id, rent.id, { name: "Food " }, withKey),
		).rejects.toMatchObject(CONFLICT);
		const before = await indexOf(rent.id);
		await updateCategory(a.db, a.user.id, rent.id, { name: "Home" }, withKey);
		const after = await indexOf(rent.id);
		expect(after).not.toBe(before);
		const key = await a.db.$transaction((tx) =>
			getOrCreateDataKeyring(tx, master),
		);
		expect(after).toBe(computeCategoryNameIndex(key, "Home"));
		// Changing only the color leaves the index alone.
		await updateCategory(a.db, a.user.id, rent.id, { color: "blue" }, withKey);
		expect(await indexOf(rent.id)).toBe(after);
	});

	it("answers two creates of one name at once with one row and one conflict", async () => {
		const a = await createTestUser();
		const results = await Promise.allSettled([
			create(a, "Race"),
			create(a, "Race"),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const failed = results.find((r) => r.status === "rejected");
		expect(failed).toMatchObject({ reason: CONFLICT });
		expect(
			await adminDb.category.count({
				where: { userId: a.user.id, name: "Race" },
			}),
		).toBe(1);
	});

	it("the unique index itself refuses a second row with one index", async () => {
		const a = await createTestUser();
		const base = { userId: a.user.id, color: "orange" as const };
		await adminDb.category.create({
			data: { ...base, name: "One", nameIndex: "x" },
		});
		await expect(
			adminDb.category.create({
				data: { ...base, name: "Two", nameIndex: "x" },
			}),
		).rejects.toMatchObject({ code: "P2002" });
		// Rows with no index never collide.
		await adminDb.category.create({ data: { ...base, name: "Three" } });
		await adminDb.category.create({ data: { ...base, name: "Four" } });
	});

	it("with no master key keeps names unique by name and the index empty", async () => {
		const a = await createTestUser();
		const none = { masterKeyring: null };
		const food = await create(a, "Food", none);
		expect(await indexOf(food.id)).toBeNull();
		await expect(create(a, "Food ", none)).rejects.toMatchObject(CONFLICT);
		// A rename with no key clears an index an earlier key made.
		await adminDb.category.update({
			where: { id: food.id },
			data: { nameIndex: "stale" },
		});
		await updateCategory(a.db, a.user.id, food.id, { name: "Meals" }, none);
		expect(await indexOf(food.id)).toBeNull();
	});

	it("matches an unindexed row by name and an indexed one by index", async () => {
		const a = await createTestUser();
		await adminDb.category.create({
			data: { userId: a.user.id, name: "Legacy", color: "orange" },
		});
		await expect(create(a, "Legacy ")).rejects.toMatchObject(CONFLICT);
		const fresh = await create(a, "Fresh");
		// With the stored name unreadable to a name compare, the index decides.
		await adminDb.category.update({
			where: { id: fresh.id },
			data: { name: "\u0001k1:opaque" },
		});
		await expect(create(a, "Fresh")).rejects.toMatchObject(CONFLICT);
	});

	it("backfills every row, and a second run changes nothing", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const rows = [
			{ userId: a.user.id, name: "Food" },
			{ userId: a.user.id, name: "Rent" },
			{ userId: b.user.id, name: "Food" },
		];
		await adminDb.category.createMany({
			data: rows.map((r) => ({ ...r, color: "orange" as const })),
		});
		// Only these users: earlier files in this worker's database may have
		// left categories whose keys were wrapped by another master key.
		const only = { userIds: [a.user.id, b.user.id] };
		const first = await backfillCategoryNameIndexes(adminDb, master, only);
		expect(first).toEqual({ updated: 3, conflicts: 0 });
		const mine = await adminDb.category.findMany({
			where: { userId: { in: [a.user.id, b.user.id] } },
			select: { userId: true, name: true, nameIndex: true },
		});
		expect(mine).toHaveLength(3);
		expect(mine.every((r) => r.nameIndex !== null)).toBe(true);
		const foodIndexes = mine
			.filter((r) => r.name === "Food")
			.map((r) => r.nameIndex);
		expect(new Set(foodIndexes).size).toBe(2);
		const second = await backfillCategoryNameIndexes(adminDb, master, only);
		expect(second).toEqual({ updated: 0, conflicts: 0 });
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master),
		).toEqual({ updated: 0, conflicts: 0 });
		// The same index create would have made.
		const key = await a.db.$transaction((tx) =>
			getOrCreateDataKeyring(tx, master),
		);
		expect(
			mine.find((r) => r.userId === a.user.id && r.name === "Rent")?.nameIndex,
		).toBe(computeCategoryNameIndex(key, "Rent"));
	});

	it("leaves a row whose trimmed name is taken without an index and counts it", async () => {
		const a = await createTestUser();
		await adminDb.category.createMany({
			data: [
				{ userId: a.user.id, name: "Food", color: "orange" },
				{ userId: a.user.id, name: "Food ", color: "orange" },
				{ userId: a.user.id, name: "Other", color: "orange" },
			],
		});
		const result = await backfillCategoryNameIndexForUser(
			adminDb,
			a.user.id,
			master,
		);
		expect(result).toEqual({ updated: 2, conflicts: 1 });
		const nulls = await adminDb.category.count({
			where: { userId: a.user.id, nameIndex: null },
		});
		expect(nulls).toBe(1);
		// Running again reports the same conflict and writes nothing.
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master),
		).toEqual({ updated: 0, conflicts: 1 });
	});

	it("cannot be computed without the user's own keyring", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const row = await create(a, "Food");
		const stored = await indexOf(row.id);
		// B's session derives from B's key: a different index for the same name.
		const asB = await userTransaction(b.db, b.user.id, (tx) =>
			categoryNameIndexFor(tx, "Food", master),
		);
		expect(asB).not.toBe(stored);
		// A session is bound to its user: asking as A gives A's index.
		const asA = await userTransaction(a.db, a.user.id, (tx) =>
			categoryNameIndexFor(tx, "Food", master),
		);
		expect(asA).toBe(stored);
		// No signed-in user, no key, no index.
		await expect(
			adminDb.$transaction((tx) => categoryNameIndexFor(tx, "Food", master)),
		).rejects.toBeInstanceOf(DataKeyError);
		// A master key that did not wrap A's key cannot open it.
		const wrong = new Keyring([{ id: 1, key: randomBytes(32) }]);
		await expect(
			userTransaction(a.db, a.user.id, (tx) =>
				categoryNameIndexFor(tx, "Food", wrong),
			),
		).rejects.toMatchObject({ code: "auth_failed" });
	});
});
