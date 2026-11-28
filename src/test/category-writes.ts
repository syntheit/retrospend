/**
 * Category create and edit as one db-level call, for tests that exercise the
 * service rather than a transport. They keep the old signatures (a client, a
 * user, the fields, and the `masterKeyring` a test passes to name an index key)
 * and run the one write the mutations run (insertCategory, updateCategoryIn)
 * in one user transaction.
 */
import { userTransaction } from "~/server/db-tx";
import type { db as globalDb } from "~/server/db";
import {
	asNameTaken,
	type CategoryInput,
	type CategoryUpdateOptions,
	type CategoryWriteOptions,
	getCategory,
	insertCategory,
	updateCategoryIn,
} from "~/server/services/category.service";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";

type AppDb = typeof globalDb;

export async function createCategory(
	db: AppDb,
	userId: string,
	input: CategoryInput,
	options: CategoryWriteOptions = {},
) {
	await ensureUserKeyringWhenSealing(userId, options.masterKeyring);
	try {
		return await userTransaction(db, userId, (tx) =>
			insertCategory(tx, userId, input, options.masterKeyring),
		);
	} catch (error) {
		throw asNameTaken(error);
	}
}

export async function updateCategory(
	db: AppDb,
	userId: string,
	id: string,
	changes: Partial<CategoryInput>,
	options: CategoryUpdateOptions = {},
) {
	await getCategory(db, userId, id);
	if (changes.name !== undefined)
		await ensureUserKeyringWhenSealing(userId, options.masterKeyring);
	return userTransaction(db, userId, (tx) =>
		updateCategoryIn(tx, userId, id, changes, options),
	);
}
