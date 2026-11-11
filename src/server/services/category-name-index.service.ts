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
 *
 * Stored form: "<16 hex tag>:<64 hex>" (see blind-index.ts). The tag names the data
 * key the hash was made with. An index counts only while its tag is the
 * current one; after the key was replaced every old index is stale, and
 * until `backfillCategoryNameIndexForUser` runs with `recompute` the name
 * compare protects those rows.
 */
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { Prisma } from "~prisma";
import { blindIndex, blindIndexTag } from "../crypto/blind-index";
import { FieldCryptoError, type Keyring } from "../crypto/field-crypto";
import { getMasterKeyring } from "../crypto/master-key";
import { sealing } from "../crypto/sealing";
import {
	DataKeyError,
	dataKeyringInTransaction,
	getOrCreateDataKeyring,
} from "./keys/data-key.service";

export const CATEGORY_NAME_INDEX_LABEL = "retrospend category name index v1";

/** The text two names are compared by. */
export const categoryNameIndexText = (name: string): string => name.trim();

export function computeCategoryNameIndex(
	keyring: Keyring,
	name: string,
): string {
	const text = categoryNameIndexText(name);
	return `${blindIndexTag(keyring, CATEGORY_NAME_INDEX_LABEL)}:${blindIndex(keyring, CATEGORY_NAME_INDEX_LABEL, text)}`;
}

/** The key tag an index was made with. */
export const categoryNameIndexTag = (stored: string): string =>
	stored.slice(0, stored.indexOf(":"));

/**
 * True when two stored indexes were made with the same key, so comparing them
 * says something. A null or an index of another key says nothing.
 */
export function comparableIndexes(
	a: string | null,
	b: string | null,
): a is string {
	return (
		a !== null &&
		b !== null &&
		categoryNameIndexTag(a) === categoryNameIndexTag(b)
	);
}

export const isUniqueViolation = (error: unknown): boolean =>
	error instanceof Prisma.PrismaClientKnownRequestError &&
	error.code === "P2002";

/**
 * The index of `name` for the signed-in user of `tx` (a user-scoped
 * transaction), or null when there is no index to make: the instance has no
 * master key, or the key store cannot give this user's key (missing, grants
 * lost, keys lost, or a master key that does not open it). A null index is safe while
 * the old unique index and the name compare still protect, so a broken key
 * store never blocks a category write; the reason is logged without a user id
 * or a name. While sealing it never makes a key: a preview of a user with
 * none gets null (and writes the name plaintext, rolled back), and any other
 * transaction fails with the retryable `key_rotated` (data-key.service.ts,
 * `dataKeyringInTransaction`). Postgres aborts a transaction on a failed statement, so the key
 * work runs under a savepoint that is rolled back on failure.
 * `masterKeyring` defaults to the process's; null means none, for tests.
 */
export async function categoryNameIndexFor(
	tx: Prisma.TransactionClient,
	name: string,
	masterKeyring: Keyring | null | undefined = getMasterKeyring(),
): Promise<string | null> {
	const [index] = await categoryNameIndexesFor(tx, [name], masterKeyring);
	return index ?? null;
}

/** `categoryNameIndexFor` for several names at once, with one key load: all null or none. */
export async function categoryNameIndexesFor(
	tx: Prisma.TransactionClient,
	names: readonly string[],
	masterKeyring: Keyring | null | undefined = getMasterKeyring(),
): Promise<(string | null)[]> {
	if (!masterKeyring || names.length === 0) return names.map(() => null);
	await tx.$executeRaw`SAVEPOINT category_name_index`;
	try {
		// While sealing, the key is made before the transaction, never in it.
		const keyring = sealing()
			? await dataKeyringInTransaction(tx, masterKeyring)
			: await getOrCreateDataKeyring(tx, masterKeyring);
		const indexes = names.map((name) =>
			keyring ? computeCategoryNameIndex(keyring, name) : null,
		);
		await tx.$executeRaw`RELEASE SAVEPOINT category_name_index`;
		return indexes;
	} catch (error) {
		// Only what a broken key store looks like. no_user (no signed-in
		// transaction) is a programming error and must surface.
		const fallback =
			error instanceof FieldCryptoError ||
			(error instanceof DataKeyError &&
				(error.code === "keystore_missing" ||
					error.code === "keystore_grants_missing" ||
					error.code === "keystore_lost"));
		if (!fallback) throw error;
		await tx.$executeRaw`ROLLBACK TO SAVEPOINT category_name_index`;
		console.warn(
			`Category name index skipped, the key store gave no usable key (${error.code})`,
		);
		return names.map(() => null);
	}
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
	/**
	 * Rows with an index made by another key (the user's key was replaced),
	 * left alone because `recompute` was not set. Zero after a recompute.
	 */
	stale: number;
};

export type CategoryNameIndexRun = CategoryNameIndexBackfill & {
	/**
	 * Users skipped because a category was created at the same moment and took
	 * a name this run was about to index. Nothing of theirs was written; run
	 * again.
	 */
	skippedUsers: number;
};

/**
 * Gives one user's categories an index where they have none. Safe to run
 * again: rows with a current index are left alone, so a second run updates
 * nothing. With `recompute`, a row whose index was made by another key (the
 * user's key was replaced) is rewritten too; without it such rows are only
 * counted as `stale`. Runs in one scoped transaction, which is also what lets
 * the keystore function read the user's key.
 */
export async function backfillCategoryNameIndexForUser(
	db: Pick<typeof globalDb, "$transaction">,
	userId: string,
	masterKeyring: Keyring,
	options: { recompute?: boolean } = {},
): Promise<CategoryNameIndexBackfill> {
	return userTransaction(db, userId, async (tx) => {
		const rows = await tx.category.findMany({
			where: { userId },
			select: { id: true, name: true, nameIndex: true },
			orderBy: { id: "asc" },
		});
		if (rows.length === 0) return { updated: 0, conflicts: 0, stale: 0 };
		const keyring = await getOrCreateDataKeyring(tx, masterKeyring);
		const tag = blindIndexTag(keyring, CATEGORY_NAME_INDEX_LABEL);
		const isCurrent = (index: string | null) =>
			index !== null && categoryNameIndexTag(index) === tag;
		const stale = rows.filter((r) => r.nameIndex && !isCurrent(r.nameIndex));
		const todo = rows.filter(
			(r) =>
				r.nameIndex === null || (options.recompute && !isCurrent(r.nameIndex)),
		);
		const taken = new Set(
			rows.flatMap((r) =>
				r.nameIndex && isCurrent(r.nameIndex) ? [r.nameIndex] : [],
			),
		);
		let updated = 0;
		let conflicts = 0;
		for (const row of todo) {
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
		return {
			updated,
			conflicts,
			stale: options.recompute ? 0 : stale.length,
		};
	});
}

/**
 * Backfills every user that has a category without an index (with
 * `recompute`, every user with a category, since a stale index cannot be
 * found in SQL). `db` is the global client (it lists the users); each user's
 * work runs as that user. A user whose transaction loses a race to a
 * concurrent category create (P2002) is skipped and counted, not fatal.
 * `userIds` limits the run to those users. `onUser` hears each result (null
 * for a skipped user), for the script's progress line.
 */
export async function backfillCategoryNameIndexes(
	db: typeof globalDb,
	masterKeyring: Keyring,
	options: {
		userIds?: string[];
		recompute?: boolean;
		onUser?: (userId: string, result: CategoryNameIndexBackfill | null) => void;
	} = {},
): Promise<CategoryNameIndexRun> {
	const users = await db.category.findMany({
		where: {
			...(options.recompute ? {} : { nameIndex: null }),
			...(options.userIds ? { userId: { in: options.userIds } } : {}),
		},
		distinct: ["userId"],
		select: { userId: true },
		orderBy: { userId: "asc" },
	});
	const total: CategoryNameIndexRun = {
		updated: 0,
		conflicts: 0,
		stale: 0,
		skippedUsers: 0,
	};
	for (const { userId } of users) {
		try {
			const result = await backfillCategoryNameIndexForUser(
				db,
				userId,
				masterKeyring,
				{ recompute: options.recompute ?? false },
			);
			total.updated += result.updated;
			total.conflicts += result.conflicts;
			total.stale += result.stale;
			options.onUser?.(userId, result);
		} catch (error) {
			if (!isUniqueViolation(error)) throw error;
			total.skippedUsers += 1;
			options.onUser?.(userId, null);
		}
	}
	return total;
}
