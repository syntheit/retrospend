import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { CategoryColor, Prisma } from "~prisma";

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

async function assertNameFree(
	db: AppDb,
	userId: string,
	name: string,
	exceptId?: string,
) {
	const clash = await db.category.findFirst({
		where: { userId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
		select: { id: true },
	});
	if (clash) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Category name already exists",
		});
	}
}

export async function createCategory(
	db: AppDb,
	userId: string,
	input: CategoryInput,
): Promise<CategoryRow> {
	await assertNameFree(db, userId, input.name);
	return db.category.create({
		data: {
			name: input.name,
			color: input.color,
			icon: input.icon ?? undefined,
			excludeByDefault: input.excludeByDefault ?? false,
			userId,
		},
		select: CATEGORY_SELECT,
	});
}

/** Changes the fields given; `icon: null` removes the icon. */
export async function updateCategory(
	db: AppDb,
	userId: string,
	id: string,
	changes: Partial<CategoryInput>,
): Promise<CategoryRow> {
	await getCategory(db, userId, id);
	if (changes.name !== undefined)
		await assertNameFree(db, userId, changes.name, id);
	const data = Object.fromEntries(
		Object.entries(changes).filter(([, v]) => v !== undefined),
	) as Prisma.CategoryUpdateInput;
	return db.category.update({
		where: { id, userId },
		data,
		select: CATEGORY_SELECT,
	});
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
