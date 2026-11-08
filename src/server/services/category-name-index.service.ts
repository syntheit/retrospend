/**
 * The blind index of a category name (E2EE lane D9): what keeps a person's
 * category names unique once the names themselves are ciphertext. See
 * src/server/crypto/blind-index.ts for the hash and the migration
 * 20261109700000_category_name_index for the column.
 *
 * What counts as the same name is what the app has always enforced: the
 * trimmed text, compared exactly. "Food" and "Food " are one name; "Food"
 * and "food" are two; there is no Unicode folding. (The database's own unique
 * index on name is stricter still, it does not trim.) This is not the rule
 * of `categoryNameKey` in src/lib/category-name-key.ts: that one also
 * lower-cases, because a file's "food" must find the category "Food", and it
 * never decides what may be created.
 */
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import { blindIndex } from "../crypto/blind-index";
import type { Keyring } from "../crypto/field-crypto";
import { getMasterKeyring } from "../crypto/master-key";
import { getOrCreateDataKeyring } from "./keys/data-key.service";

export const CATEGORY_NAME_INDEX_LABEL = "retrospend category name index v1";

/** The text two names are compared by. */
export const categoryNameIndexText = (name: string): string => name.trim();

export function computeCategoryNameIndex(
	keyring: Keyring,
	name: string,
): string {
	return blindIndex(
		keyring,
		CATEGORY_NAME_INDEX_LABEL,
		categoryNameIndexText(name),
	);
}

/**
 * The index of `name` for the signed-in user of `tx` (a user-scoped
 * transaction), or null when the instance has no master key. `masterKeyring`
 * defaults to the process's; null means none, for tests.
 */
export async function categoryNameIndexFor(
	tx: Prisma.TransactionClient,
	name: string,
	masterKeyring: Keyring | null | undefined = getMasterKeyring(),
): Promise<string | null> {
	if (!masterKeyring) return null;
	const keyring = await getOrCreateDataKeyring(tx, masterKeyring);
	return computeCategoryNameIndex(keyring, name);
}

export type CategoryNameIndexBackfill = {
	/** Rows that got an index. */
	updated: number;
	/**
	 * Rows left without one because another row of the same user has the same
	 * trimmed name (names that differ only by edge spaces, saved before the
	 * app trimmed). Someone has to rename or merge one.
	 */
	conflicts: number;
};

/**
 * Gives one user's categories an index where they have none. Safe to run
 * again: rows that have one are left alone, so a second run updates nothing.
 * Runs in one scoped transaction, which is also what lets the keystore
 * function read the user's key.
 */
export async function backfillCategoryNameIndexForUser(
	db: Pick<typeof globalDb, "$transaction">,
	userId: string,
	masterKeyring: Keyring,
): Promise<CategoryNameIndexBackfill> {
	return userTransaction(db, userId, async (tx) => {
		const rows = await tx.category.findMany({
			where: { userId },
			select: { id: true, name: true, nameIndex: true },
			orderBy: { id: "asc" },
		});
		const missing = rows.filter((row) => row.nameIndex === null);
		if (missing.length === 0) return { updated: 0, conflicts: 0 };
		const keyring = await getOrCreateDataKeyring(tx, masterKeyring);
		const taken = new Set(
			rows.flatMap((row) => (row.nameIndex ? [row.nameIndex] : [])),
		);
		let updated = 0;
		let conflicts = 0;
		for (const row of missing) {
			const nameIndex = computeCategoryNameIndex(keyring, row.name);
			if (taken.has(nameIndex)) {
				conflicts += 1;
				continue;
			}
			taken.add(nameIndex);
			await tx.category.update({
				where: { id: row.id, userId },
				data: { nameIndex },
			});
			updated += 1;
		}
		return { updated, conflicts };
	});
}

/**
 * Backfills every user that has a category without an index. `db` is the
 * global client (it lists the users); each user's work runs as that user.
 * `userIds` limits the run to those users. `onUser` hears each result, for
 * the script's progress line.
 */
export async function backfillCategoryNameIndexes(
	db: typeof globalDb,
	masterKeyring: Keyring,
	options: {
		userIds?: string[];
		onUser?: (userId: string, result: CategoryNameIndexBackfill) => void;
	} = {},
): Promise<CategoryNameIndexBackfill> {
	const users = await db.category.findMany({
		where: {
			nameIndex: null,
			...(options.userIds ? { userId: { in: options.userIds } } : {}),
		},
		distinct: ["userId"],
		select: { userId: true },
		orderBy: { userId: "asc" },
	});
	const total = { updated: 0, conflicts: 0 };
	for (const { userId } of users) {
		const result = await backfillCategoryNameIndexForUser(
			db,
			userId,
			masterKeyring,
		);
		total.updated += result.updated;
		total.conflicts += result.conflicts;
		options.onUser?.(userId, result);
	}
	return total;
}
