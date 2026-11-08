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
 *   key replaced, "Food" indexed       -> its index is stale: "Food " still refused by name
 *   recompute                          -> the stale row gets a current index, then 0 updated
 *   key store missing, grants lost,
 *   master key wrong                   -> the write goes through with a null index
 *   a create racing a backfill         -> that user is skipped and counted
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blindIndexTag } from "~/server/crypto/blind-index";
import { Keyring } from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, withSuperuser } from "~/test/pg-harness";
import {
	type CategoryWriteOptions,
	createCategory,
	updateCategory,
} from "../category.service";
import {
	backfillCategoryNameIndexes,
	backfillCategoryNameIndexForUser,
	CATEGORY_NAME_INDEX_LABEL,
	categoryNameIndexFor,
	computeCategoryNameIndex,
} from "../category-name-index.service";
import {
	DataKeyError,
	destroyDataKeys,
	getOrCreateDataKeyring,
} from "../keys/data-key.service";

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

const ringOf = (who: TestUser) =>
	who.db.$transaction((tx) => getOrCreateDataKeyring(tx, master));

afterEach(() => {
	vi.restoreAllMocks();
});

describe("category name index", () => {
	it("gives the same name different indexes for two users", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const rowA = await create(a, "Food");
		const rowB = await create(b, "Food");
		const [ia, ib] = [await indexOf(rowA.id), await indexOf(rowB.id)];
		expect(ia).toMatch(/^[0-9a-f]{16}:[0-9a-f]{64}$/);
		expect(ib).toMatch(/^[0-9a-f]{16}:[0-9a-f]{64}$/);
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
		// Make the user's key first: otherwise both creates mint it, and the
		// keystore's insert serializes them before either reaches the category.
		await ringOf(a);
		// "Race " is a trimmed duplicate, so the old unique index (exact names)
		// cannot stop it; only the name index can.
		const results = await Promise.allSettled([
			create(a, "Race"),
			create(a, "Race "),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const failed = results.find((r) => r.status === "rejected");
		expect(failed).toMatchObject({ reason: CONFLICT });
		expect(
			await adminDb.category.count({
				where: { userId: a.user.id, name: { in: ["Race", "Race "] } },
			}),
		).toBe(1);
	});

	it("the unique index itself refuses a second row with one index", async () => {
		const a = await createTestUser();
		const base = { userId: a.user.id, color: "orange" as const };
		const same = `0123456789abcdef:${"ab".repeat(32)}`;
		await adminDb.category.create({
			data: { ...base, name: "One", nameIndex: same },
		});
		await expect(
			adminDb.category.create({
				data: { ...base, name: "Two", nameIndex: same },
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
		expect(first).toEqual({
			updated: 3,
			conflicts: 0,
			stale: 0,
			skippedUsers: 0,
		});
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
		expect(second).toEqual({
			updated: 0,
			conflicts: 0,
			stale: 0,
			skippedUsers: 0,
		});
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master),
		).toEqual({ updated: 0, conflicts: 0, stale: 0 });
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
		expect(result).toEqual({ updated: 2, conflicts: 1, stale: 0 });
		const nulls = await adminDb.category.count({
			where: { userId: a.user.id, nameIndex: null },
		});
		expect(nulls).toBe(1);
		// Running again reports the same conflict and writes nothing.
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master),
		).toEqual({ updated: 0, conflicts: 1, stale: 0 });
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
		// No signed-in user: no key and no index, and not swallowed, since that
		// is a programming error and not a broken key store.
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await expect(
			adminDb.$transaction((tx) => getOrCreateDataKeyring(tx, master)),
		).rejects.toBeInstanceOf(DataKeyError);
		await expect(
			adminDb.$transaction((tx) => categoryNameIndexFor(tx, "Food", master)),
		).rejects.toMatchObject({ code: "no_user" });
		// A master key that did not wrap A's key cannot open it.
		const wrong = new Keyring([{ id: 1, key: randomBytes(32) }]);
		await expect(
			userTransaction(a.db, a.user.id, (tx) =>
				getOrCreateDataKeyring(tx, wrong),
			),
		).rejects.toMatchObject({ code: "auth_failed" });
		expect(
			await userTransaction(a.db, a.user.id, (tx) =>
				categoryNameIndexFor(tx, "Food", wrong),
			),
		).toBeNull();
	});

	it("ignores an index made by a replaced key and repairs it on recompute", async () => {
		const a = await createTestUser();
		const food = await create(a, "Food");
		const oldIndex = await indexOf(food.id);
		const oldTag = blindIndexTag(await ringOf(a), CATEGORY_NAME_INDEX_LABEL);
		// The key is lost and made again: key id 1 with other bytes.
		await destroyDataKeys(a.user.id);
		const newTag = blindIndexTag(await ringOf(a), CATEGORY_NAME_INDEX_LABEL);
		expect(newTag).not.toBe(oldTag);
		// The new index of the same name differs, so an index compare would let
		// a trimmed duplicate through; the name compare must still refuse it.
		await expect(create(a, "Food ")).rejects.toMatchObject(CONFLICT);
		const other = await create(a, "Other");
		await expect(
			updateCategory(a.db, a.user.id, other.id, { name: "Food " }, withKey),
		).rejects.toMatchObject(CONFLICT);
		expect(await indexOf(food.id)).toBe(oldIndex);
		// Without recompute the stale row is counted and left alone.
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master),
		).toEqual({ updated: 0, conflicts: 0, stale: 1 });
		expect(await indexOf(food.id)).toBe(oldIndex);
		// With it the row gets an index of the current key, and a second run
		// changes nothing.
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master, {
				recompute: true,
			}),
		).toEqual({ updated: 1, conflicts: 0, stale: 0 });
		const key = await ringOf(a);
		expect(await indexOf(food.id)).toBe(computeCategoryNameIndex(key, "Food"));
		expect(
			await backfillCategoryNameIndexForUser(adminDb, a.user.id, master, {
				recompute: true,
			}),
		).toEqual({ updated: 0, conflicts: 0, stale: 0 });
		// Now both rows are compared by index, and the duplicate is still refused.
		await expect(create(a, "Food ")).rejects.toMatchObject(CONFLICT);
	});

	describe("when the key store gives no key", () => {
		const warnings = () =>
			vi.spyOn(console, "warn").mockImplementation(() => undefined);

		/** The write goes through with a null index and a name-compare duplicate check. */
		const expectFallback = async (a: TestUser, code: string) => {
			const warn = warnings();
			const food = await create(a, "Secret Food");
			expect(await indexOf(food.id)).toBeNull();
			await expect(create(a, "Secret Food ")).rejects.toMatchObject(CONFLICT);
			const rent = await create(a, "Rent");
			await updateCategory(a.db, a.user.id, rent.id, { name: "Home" }, withKey);
			expect(await indexOf(rent.id)).toBeNull();
			const logged = warn.mock.calls.flat().join(" ");
			expect(logged).toContain(code);
			expect(logged).not.toContain("Secret Food");
			expect(logged).not.toContain(a.user.id);
		};

		it("keeps writing when the keystore schema is missing", async () => {
			const a = await createTestUser();
			const rename = (from: string, to: string) =>
				withSuperuser((c) => c.query(`ALTER SCHEMA ${from} RENAME TO ${to}`));
			await rename("keystore", "keystore_gone");
			try {
				await expectFallback(a, "keystore_missing");
			} finally {
				await rename("keystore_gone", "keystore");
			}
			// Back to normal: the next write is indexed again.
			const again = await create(a, "Back");
			expect(await indexOf(again.id)).not.toBeNull();
		});

		it("keeps writing when the app lost its keystore grants", async () => {
			const a = await createTestUser();
			await adminDb.$executeRawUnsafe(
				'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
			);
			try {
				await expectFallback(a, "keystore_grants_missing");
			} finally {
				await adminDb.$executeRawUnsafe(
					'GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app',
				);
			}
		});

		it("keeps writing when the master key does not open the user's key", async () => {
			const a = await createTestUser();
			await create(a, "Seed");
			const wrong = new Keyring([{ id: 1, key: randomBytes(32) }]);
			const warn = warnings();
			const row = await createCategory(a.db, a.user.id, input("Secret Food"), {
				masterKeyring: wrong,
			});
			expect(await indexOf(row.id)).toBeNull();
			await expect(
				createCategory(a.db, a.user.id, input("Secret Food "), {
					masterKeyring: wrong,
				}),
			).rejects.toMatchObject(CONFLICT);
			const logged = warn.mock.calls.flat().join(" ");
			expect(logged).toContain("auth_failed");
			expect(logged).not.toContain("Secret Food");
			expect(logged).not.toContain(a.user.id);
		});
	});

	it("skips a user whose backfill loses a race to a create and carries on", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const foods = await Promise.all(
			[a, b].map((who) =>
				adminDb.category.create({
					data: { userId: who.user.id, name: "Food", color: "orange" },
				}),
			),
		);
		const foodA = foods[0];
		if (!foodA) throw new Error("setup");
		const keyA = await ringOf(a);
		// Just before A's row is updated, another connection commits a category
		// that takes the index that update is about to write.
		let raced = false;
		const racing = new Proxy(adminDb, {
			get(target, prop) {
				if (prop !== "$transaction") return Reflect.get(target, prop, target);
				return (work: (tx: unknown) => Promise<unknown>, options?: object) =>
					target.$transaction(async (tx) => {
						const category = new Proxy(tx.category, {
							get(model, key) {
								const value = Reflect.get(model, key, model);
								if (key !== "update") return value;
								return async (args: { where: { id: string } }) => {
									if (!raced && args.where.id === foodA.id) {
										raced = true;
										await adminDb.category.create({
											data: {
												userId: a.user.id,
												name: "Elsewhere",
												color: "orange",
												nameIndex: computeCategoryNameIndex(keyA, "Food"),
											},
										});
									}
									return model.update(args as never);
								};
							},
						});
						return work(
							new Proxy(tx, {
								get(inner, key) {
									if (key === "category") return category;
									const value = Reflect.get(inner, key, inner);
									return typeof value === "function"
										? value.bind(inner)
										: value;
								},
							}),
						);
					}, options);
			},
		});
		const seen = new Map<string, boolean>();
		const result = await backfillCategoryNameIndexes(racing, master, {
			userIds: [a.user.id, b.user.id],
			onUser: (id, r) => seen.set(id, r !== null),
		});
		expect(raced).toBe(true);
		expect(result.skippedUsers).toBe(1);
		expect(result.updated).toBe(1);
		expect(seen.get(a.user.id)).toBe(false);
		expect(seen.get(b.user.id)).toBe(true);
		// Nothing of A's run was written; B's row got its index.
		expect(await indexOf(foodA.id)).toBeNull();
		expect(
			await adminDb.category.count({
				where: { userId: b.user.id, nameIndex: null },
			}),
		).toBe(0);
		// Run again: A's "Food" now conflicts with the row that won the race.
		expect(
			await backfillCategoryNameIndexes(adminDb, master, {
				userIds: [a.user.id],
			}),
		).toEqual({ updated: 0, conflicts: 1, stale: 0, skippedUsers: 0 });
	});
});
