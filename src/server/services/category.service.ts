import { sameCategoryName } from "@retrospend/domain/category-name";
import { CategoryChangedError } from "@retrospend/domain/category-version";
import { IdTakenError } from "@retrospend/domain/id-taken";
import { TRPCError } from "@trpc/server";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { uniqueViolation } from "~/server/api/unique-violation";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { type CategoryColor, type CategoryKind, Prisma } from "~prisma";
import type { Keyring } from "../crypto/field-crypto";
import {
	categoryNameIndexesFor,
	categoryNameIndexFor,
	comparableIndexes,
	isUniqueViolation,
} from "./category-name-index.service";
import { ensureUserKeyringWhenSealing } from "./keys/data-key.service";
import { byUsageThenName, compareText, sortByText } from "./text-order";
import {
	isOwnCategory,
	ownCategoryWhere,
} from "~/server/services/category/own";

type AppDb = typeof globalDb;

/**
 * Categories: the one implementation behind the tRPC categories router and
 * /api/v1/categories. Callers pass a user-scoped client; every query also
 * names the user, so a category id from someone else is simply not found.
 */

export const CATEGORY_SELECT = {
	id: true,
	name: true,
	color: true,
	icon: true,
	kind: true,
	excludeByDefault: true,
	version: true,
	_count: { select: { expenses: true } },
} as const satisfies Prisma.CategorySelect;

export type CategoryRow = Prisma.CategoryGetPayload<{
	select: typeof CATEGORY_SELECT;
}>;

export interface CategoryInput {
	name: string;
	color: CategoryColor;
	icon?: string | null;
	excludeByDefault?: boolean;
}

/**
 * The web's picker order: most used first, then by name. The name part is
 * sorted here, not by Postgres, because a name may be ciphertext (text-order.ts).
 */
export async function listCategoriesByUsage(db: AppDb, userId: string) {
	const rows = await db.category.findMany({
		where: { userId },
		select: CATEGORY_SELECT,
	});
	return byUsageThenName(rows);
}

/**
 * A page by name (ties by id), starting after `after`. A user's categories
 * are few, so all of them are read and the page is cut after sorting, because
 * Postgres cannot order or compare names that may be ciphertext.
 */
export async function listCategoriesByName(
	db: AppDb,
	userId: string,
	page: { after: { name: string; id: string } | null; take: number },
): Promise<CategoryRow[]> {
	const { after } = page;
	const rows = sortByText(
		await db.category.findMany({ where: { userId }, select: CATEGORY_SELECT }),
		(c) => c.name,
	);
	const later = after
		? rows.filter(
				(c) =>
					compareText(c.name, after.name) > 0 ||
					(c.name === after.name && compareText(c.id, after.id) > 0),
			)
		: rows;
	return later.slice(0, page.take);
}

export async function getCategory(
	db: AppDb,
	userId: string,
	id: string,
): Promise<CategoryRow> {
	const row = await db.category.findFirst({
		where: ownCategoryWhere(userId, id),
		select: CATEGORY_SELECT,
	});
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
	return row;
}

const nameTaken = () =>
	new TRPCError({ code: "CONFLICT", message: "Category name already exists" });

/**
 * Names are stored as typed, but "Food " and "Food" are the same name to the
 * person (the domain's name rule, category-name.ts). Compared here, not in SQL, so it keeps
 * working when names are encrypted; a person has few categories. A row with
 * a name index is compared by index, which holds once names are ciphertext,
 * but only while both indexes were made with the same key; a row not
 * backfilled yet (`nameIndex` null) or indexed by a key the user no longer has
 * (stale), and every row when there is no index to make, by its trimmed name.
 */
async function assertNameFree(
	tx: Prisma.TransactionClient,
	userId: string,
	name: string,
	nameIndex: string | null,
	exceptId?: string,
) {
	const mine = await tx.category.findMany({
		where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
		select: { name: true, nameIndex: true },
	});
	const taken = mine.some((row) =>
		comparableIndexes(nameIndex, row.nameIndex)
			? row.nameIndex === nameIndex
			: sameCategoryName(row.name, name),
	);
	if (taken) throw nameTaken();
}

/**
 * A write that loses a race on either unique index (the old one on the name,
 * the new one on the name index) is the same answer as one that sees the
 * name taken. A taken id (the primary key) is not a name: it leaves as it is
 * and the transports answer id_taken.
 */
export function asNameTaken(error: unknown): unknown {
	if (!isUniqueViolation(error)) return error;
	return uniqueViolation(error)?.problem === "id_taken" ? error : nameTaken();
}

/** `masterKeyring` is for tests: null means no master key. */
export interface CategoryWriteOptions {
	masterKeyring?: Keyring | null;
}

/** Every column of a category row, as an insert takes it. */
export interface CategoryInsert extends CategoryInput {
	/** A client-made id, or the one an undo brings the category back under. */
	id?: string;
	isFixed?: boolean;
	kind?: CategoryKind;
	/** Set by an undo, which brings the category back at the version it held. */
	version?: number;
}

/**
 * The one way a category row is inserted (create, and the undo of a delete or
 * merge): the id checked free, the name index made with the current key, the
 * name checked free by index and by trimmed name, then the row. Runs in the
 * caller's user transaction; a taken name is the CONFLICT every caller
 * answers, a taken id IdTakenError (own row, checked first so a retry of a
 * create reads as taken, not as the name being used) or the unique violation
 * of another account's row.
 */
export async function insertCategory(
	tx: Prisma.TransactionClient,
	userId: string,
	input: CategoryInsert,
	masterKeyring?: Keyring | null,
): Promise<CategoryRow> {
	if (input.id && (await isOwnCategory(tx, userId, input.id)))
		throw new IdTakenError();
	const nameIndex = await categoryNameIndexFor(tx, input.name, masterKeyring);
	await assertNameFree(tx, userId, input.name, nameIndex);
	return tx.category.create({
		data: {
			...(input.id ? { id: input.id } : {}),
			name: input.name,
			nameIndex,
			color: input.color,
			icon: input.icon ?? undefined,
			isFixed: input.isFixed ?? false,
			excludeByDefault: input.excludeByDefault ?? false,
			kind: input.kind ?? "EXPENSE",
			...(input.version === undefined ? {} : { version: input.version }),
			userId,
		},
		select: CATEGORY_SELECT,
	});
}

export interface CategoryUpdateOptions extends CategoryWriteOptions {
	/**
	 * The version the caller read. The update's filter carries it, so the
	 * write lands only on that version; another version (or a category gone
	 * since) is CategoryChangedError and nothing is written.
	 */
	expectedVersion?: number;
}

const isRecordNotFound = (error: unknown) =>
	error instanceof Prisma.PrismaClientKnownRequestError &&
	error.code === "P2025";

/**
 * Changes the fields given; `icon: null` removes the icon. A change that
 * names `name` moves the version by SQL (`version = version + 1`, no read first,
 * so two renames at once get two versions); the database trigger moves it for
 * color, icon and excludeByDefault, and does not double a rename's bump. This
 * is the only writer that sets the version on an update. Runs in the caller's
 * user transaction (the category write mutation's, or `updateCategory`'s).
 *
 * The write comes before the name check: a stale version then answers
 * "changed", not "name taken" for a name the device could not know about, and
 * the whole transaction rolls back when either refuses.
 */
export async function updateCategoryIn(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
	changes: Partial<CategoryInput>,
	options: CategoryUpdateOptions = {},
): Promise<CategoryRow> {
	const { expectedVersion } = options;
	const data = Object.fromEntries(
		Object.entries(changes).filter(([, v]) => v !== undefined),
	) as Prisma.CategoryUpdateInput;
	try {
		let nameIndex: string | null | undefined;
		if (changes.name !== undefined) {
			// A rename always rewrites the index, to null when there is no key,
			// so a stale one never survives a new name.
			nameIndex = await categoryNameIndexFor(
				tx,
				changes.name,
				options.masterKeyring,
			);
			data.nameIndex = nameIndex;
			data.version = { increment: 1 };
		}
		const row = await tx.category.update({
			where: {
				id,
				userId,
				...(expectedVersion === undefined ? {} : { version: expectedVersion }),
			},
			data,
			select: CATEGORY_SELECT,
		});
		if (changes.name !== undefined && nameIndex !== undefined)
			await assertNameFree(tx, userId, changes.name, nameIndex, id);
		return row;
	} catch (error) {
		if (isRecordNotFound(error)) throw await missingOrChanged(tx, userId, id);
		throw asNameTaken(error);
	}
}

/** The answer for an update that matched no row: the category is not the caller's, or it has another version. */
async function missingOrChanged(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
) {
	return (await isOwnCategory(tx, userId, id))
		? new CategoryChangedError()
		: new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
}

/**
 * Inserts the categories the user does not have yet, each with its name
 * index, so a name taken by name or by index is skipped. Runs in the caller's
 * user transaction.
 */
export async function insertCategoriesOnce(
	tx: Prisma.TransactionClient,
	userId: string,
	rows: readonly Omit<Prisma.CategoryCreateManyInput, "userId" | "nameIndex">[],
	masterKeyring?: Keyring | null,
): Promise<number> {
	const indexes = await categoryNameIndexesFor(
		tx,
		rows.map((r) => r.name),
		masterKeyring,
	);
	const { count } = await tx.category.createMany({
		data: rows.map((row, i) => ({ ...row, userId, nameIndex: indexes[i] })),
		skipDuplicates: true,
	});
	return count;
}

/**
 * Gives a user the default categories they do not have: at sign-up and from
 * scripts/sync-default-categories.ts. Runs as that user, so the names are
 * the user's own writes (and sealed with their key once PR 4 seals).
 */
export async function seedDefaultCategories(
	db: Pick<AppDb, "$transaction">,
	userId: string,
	options: CategoryWriteOptions = {},
): Promise<number> {
	await ensureUserKeyringWhenSealing(userId, options.masterKeyring);
	return userTransaction(db, userId, (tx) =>
		insertCategoriesOnce(tx, userId, DEFAULT_CATEGORIES, options.masterKeyring),
	);
}
