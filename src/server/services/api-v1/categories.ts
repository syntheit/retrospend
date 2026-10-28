import type {
	CategoryDto,
	CursorQuery,
	createCategorySchema,
	updateCategorySchema,
} from "@retrospend/api-contract";
import { categoryTone } from "@retrospend/domain/category-tone";
import * as z from "zod";
import {
	type CategoryRow,
	createCategory,
	deleteCategory,
	getCategory,
	listCategoriesByName,
	mergeCategory,
	updateCategory,
} from "~/server/services/category.service";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";

/** v1 adapters for /categories. */

export function toCategory(row: CategoryRow): CategoryDto {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		icon: row.icon,
		tone: categoryTone(row.color),
		excludeByDefault: row.excludeByDefault,
		expenseCount: row._count.expenses,
	};
}

const nameCursor = z.object({ name: z.string(), id: z.string() });

export async function listCategoryPage(caller: Caller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, nameCursor);
	const rows = await listCategoriesByName(caller.db, caller.principal.userId, {
		after,
		take: q.limit + 1,
	});
	return toPage(rows, q.limit, (c) => ({ name: c.name, id: c.id }), toCategory);
}

export async function readCategory(caller: Caller, id: string) {
	return toCategory(await getCategory(caller.db, caller.principal.userId, id));
}

export async function addCategory(
	caller: Caller,
	input: z.infer<typeof createCategorySchema>,
) {
	return toCategory(
		await createCategory(caller.db, caller.principal.userId, input),
	);
}

export async function changeCategory(
	caller: Caller,
	id: string,
	changes: z.infer<typeof updateCategorySchema>,
) {
	return toCategory(
		await updateCategory(caller.db, caller.principal.userId, id, changes),
	);
}

export async function removeCategory(
	caller: Caller,
	id: string,
	uncategorize: boolean,
) {
	await deleteCategory(caller.db, caller.principal.userId, id, {
		reassignToUncategorized: uncategorize,
	});
	return { ok: true as const };
}

export async function mergeCategories(
	caller: Caller,
	id: string,
	targetId: string,
) {
	return toCategory(
		await mergeCategory(caller.db, caller.principal.userId, id, targetId),
	);
}
