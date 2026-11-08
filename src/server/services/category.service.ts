import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { CategoryColor, Prisma } from "~prisma";
import type { Keyring } from "../crypto/field-crypto";
import {
	categoryNameIndexFor,
	comparableIndexes,
	isUniqueViolation,
} from "./category-name-index.service";

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

/** The web's picker order: most used first, then by name. */
export function listCategoriesByUsage(db: AppDb, userId: string) {
	return db.category.findMany({
		where: { userId },
		orderBy: [{ expenses: { _count: "desc" } }, { name: "asc" }],
		select: CATEGORY_SELECT,
	});
}

/** A page by name (ties by id), starting after `after`. */
export function listCategoriesByName(
	db: AppDb,
	userId: string,
	page: { after: { name: string; id: string } | null; take: number },
): Promise<CategoryRow[]> {
	const { after } = page;
	return db.category.findMany({
		where: {
			userId,
			...(after
				? {
						OR: [
							{ name: { gt: after.name } },
							{ name: after.name, id: { gt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ name: "asc" }, { id: "asc" }],
		take: page.take,
		select: CATEGORY_SELECT,
	});
}

export async function getCategory(
	db: AppDb,
	userId: string,
	id: string,
): Promise<CategoryRow> {
	const row = await db.category.findFirst({
		where: { id, userId },
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
 * person (the v1 API always trimmed). Compared here, not in SQL, so it keeps
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
	const wanted = name.trim();
	const mine = await tx.category.findMany({
		where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
		select: { name: true, nameIndex: true },
	});
	const taken = mine.some((row) =>
		comparableIndexes(nameIndex, row.nameIndex)
			? row.nameIndex === nameIndex
			: row.name.trim() === wanted,
	);
	if (taken) throw nameTaken();
}

/**
 * A write that loses a race on either unique index (the old one on the name,
 * the new one on the name index) is the same answer as one that sees the
 * name taken.
 */
function asNameTaken(error: unknown): unknown {
	return isUniqueViolation(error) ? nameTaken() : error;
}

/** `masterKeyring` is for tests: null means no master key. */
export interface CategoryWriteOptions {
	masterKeyring?: Keyring | null;
}

export async function createCategory(
	db: AppDb,
	userId: string,
	input: CategoryInput,
	options: CategoryWriteOptions = {},
): Promise<CategoryRow> {
	try {
		return await userTransaction(db, userId, async (tx) => {
			const nameIndex = await categoryNameIndexFor(
				tx,
				input.name,
				options.masterKeyring,
			);
			await assertNameFree(tx, userId, input.name, nameIndex);
			return tx.category.create({
				data: {
					name: input.name,
					nameIndex,
					color: input.color,
					icon: input.icon ?? undefined,
					excludeByDefault: input.excludeByDefault ?? false,
					userId,
				},
				select: CATEGORY_SELECT,
			});
		});
	} catch (error) {
		throw asNameTaken(error);
	}
}

/** Changes the fields given; `icon: null` removes the icon. */
export async function updateCategory(
	db: AppDb,
	userId: string,
	id: string,
	changes: Partial<CategoryInput>,
	options: CategoryWriteOptions = {},
): Promise<CategoryRow> {
	await getCategory(db, userId, id);
	const data = Object.fromEntries(
		Object.entries(changes).filter(([, v]) => v !== undefined),
	) as Prisma.CategoryUpdateInput;
	try {
		return await userTransaction(db, userId, async (tx) => {
			if (changes.name !== undefined) {
				// A rename always rewrites the index, to null when there is no key,
				// so a stale one never survives a new name.
				const nameIndex = await categoryNameIndexFor(
					tx,
					changes.name,
					options.masterKeyring,
				);
				await assertNameFree(tx, userId, changes.name, nameIndex, id);
				data.nameIndex = nameIndex;
			}
			return tx.category.update({
				where: { id, userId },
				data,
				select: CATEGORY_SELECT,
			});
		});
	} catch (error) {
		throw asNameTaken(error);
	}
}

/**
 * Moves everything filed under `fromId` to `toId` (null: uncategorized),
 * then deletes `fromId`, in one transaction. Budgets have a unique
 * (user, category, period): where the target already budgets a month the
 * source's budget for it is dropped; without a target budgets are deleted,
 * since a budget with no category reads as a global one.
 */
async function moveAndDelete(
	db: AppDb,
	userId: string,
	fromId: string,
	toId: string | null,
) {
	await userTransaction(db, userId, async (tx) => {
		const from = { categoryId: fromId, userId };
		await tx.expense.updateMany({ where: from, data: { categoryId: toId } });
		await tx.recurringTemplate.updateMany({
			where: from,
			data: { categoryId: toId },
		});
		// Shared expenses carry their creator's category; RLS limits this to
		// the ones the caller may edit, and the rest fall back to none when
		// the category goes.
		await tx.sharedTransaction.updateMany({
			where: { categoryId: fromId },
			data: { categoryId: toId },
		});
		if (toId) {
			const taken = await tx.budget.findMany({
				where: { categoryId: toId, userId },
				select: { period: true },
			});
			await tx.budget.deleteMany({
				where: { ...from, period: { in: taken.map((b) => b.period) } },
			});
			await tx.budget.updateMany({ where: from, data: { categoryId: toId } });
		} else {
			await tx.budget.deleteMany({ where: from });
		}
		await tx.category.delete({ where: { id: fromId, userId } });
	});
}

/**
 * Deletes a category. One that still has expenses needs a replacement
 * category or `reassignToUncategorized`, else CONFLICT.
 */
export async function deleteCategory(
	db: AppDb,
	userId: string,
	id: string,
	options: {
		replacementCategoryId?: string;
		reassignToUncategorized?: boolean;
	},
): Promise<void> {
	await getCategory(db, userId, id);
	const expenses = await db.expense.count({
		where: { categoryId: id, userId },
	});
	const { replacementCategoryId, reassignToUncategorized } = options;
	if (expenses > 0 && !replacementCategoryId && !reassignToUncategorized) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `This category has ${expenses} expense(s). Please choose a replacement category or select "Uncategorized".`,
		});
	}
	if (expenses > 0 && replacementCategoryId) {
		await mergeCategory(db, userId, id, replacementCategoryId);
		return;
	}
	await moveAndDelete(db, userId, id, null);
}

/** Moves everything in `id` into `targetId`, deletes `id`, returns the target. */
export async function mergeCategory(
	db: AppDb,
	userId: string,
	id: string,
	targetId: string,
): Promise<CategoryRow> {
	if (id === targetId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A category cannot be merged into itself",
		});
	}
	await getCategory(db, userId, id);
	const target = await db.category.findFirst({
		where: { id: targetId, userId },
		select: { id: true },
	});
	if (!target) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Replacement category not found",
		});
	}
	await moveAndDelete(db, userId, id, targetId);
	return getCategory(db, userId, targetId);
}
