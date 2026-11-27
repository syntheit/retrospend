import type {
	CategoryDto,
	CursorQuery,
	createCategorySchema,
	updateCategorySchema,
} from "@retrospend/api-contract";
import { categoryTone } from "@retrospend/domain/category-tone";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	type CategoryMerged,
	mergeCategories,
	restoreCategory,
} from "~/server/services/category/merge.mutation";
import {
	deleteRequest,
	previewRemove,
} from "~/server/services/category/remove";
import {
	type CategoryRow,
	createCategory,
	getCategory,
	listCategoriesByName,
	updateCategory,
} from "~/server/services/category.service";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";
import {
	applyWrite,
	previewWrite,
	spendUndo,
	toPreviewDto,
	undoFor,
} from "./money-write";
import { readUndo } from "./undo";

/** v1 adapters for /categories. */

export function toCategory(row: CategoryRow): CategoryDto {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		icon: row.icon,
		kind: row.kind === "INCOME" ? "income" : "expense",
		tone: categoryTone(row.color),
		excludeByDefault: row.excludeByDefault,
		expenseCount: row._count.expenses,
		version: row.version,
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

type Removal = { id: string; targetId: string | null };

const restoreOp = "category.restore";
const mergeOp = "category.merge";

/** The token that takes a delete or merge back: the stash holds the category and what moved. */
const restoreToken = (caller: Caller, done: CategoryMerged) =>
	undoFor(caller, "category", restoreOp, { stash: done.stash });

async function removal(
	caller: Caller,
	id: string,
	uncategorize: boolean,
): Promise<Removal> {
	return deleteRequest(caller.db, caller.principal.userId, id, {
		reassignToUncategorized: uncategorize,
	});
}

/** The preview's detail: what moved, what was dropped and where rows now land. */
function previewDetail(value: CategoryMerged) {
	return {
		kind: "category.merge" as const,
		mode: value.mode,
		counts: value.counts,
		rerouted: [...value.rerouted],
		setToNone: value.setToNone,
	};
}

async function previewRemoval(caller: Caller, input: Removal) {
	const preview = await previewRemove(caller.principal.userId, input);
	return { ...toPreviewDto(preview), detail: previewDetail(preview.value) };
}

export async function removeCategory(
	caller: Caller,
	id: string,
	uncategorize: boolean,
) {
	const done = await applyWrite(
		caller,
		mergeCategories,
		await removal(caller, id, uncategorize),
	);
	return { ok: true as const, undo: restoreToken(caller, done) };
}

export async function previewRemoveCategory(
	caller: Caller,
	id: string,
	uncategorize: boolean,
) {
	return previewRemoval(caller, await removal(caller, id, uncategorize));
}

export async function mergeCategoryInto(
	caller: Caller,
	id: string,
	targetId: string,
) {
	const done = await applyWrite(caller, mergeCategories, { id, targetId });
	return {
		...toCategory(
			await getCategory(caller.db, caller.principal.userId, targetId),
		),
		undo: restoreToken(caller, done),
	};
}

export const previewMergeCategory = (
	caller: Caller,
	id: string,
	targetId: string,
) => previewRemoval(caller, { id, targetId });

// ── Undo ────────────────────────────────────────────────────────────────────

/** The inverse call of a token, and the redo token its answer gives. */
function inverseOf(op: string, input: unknown) {
	if (op === restoreOp) {
		return {
			mutation: restoreCategory as MoneyMutation<unknown, unknown>,
			input,
			redo: (v: unknown) => {
				const done = v as { id: string; targetId: string | null };
				return {
					op: mergeOp,
					input: { id: done.id, targetId: done.targetId },
				};
			},
		};
	}
	if (op === mergeOp) {
		return {
			mutation: mergeCategories as MoneyMutation<unknown, unknown>,
			input,
			redo: (v: unknown) => ({
				op: restoreOp,
				input: { stash: (v as CategoryMerged).stash },
			}),
		};
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});
}

export async function undoCategoryWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "category", token);
	const inverse = inverseOf(op, input);
	return spendUndo(caller, token, async () => {
		const value = await applyWrite(caller, inverse.mutation, inverse.input);
		const redo = inverse.redo(value);
		return {
			id: (value as { id: string }).id,
			redo: undoFor(caller, "category", redo.op, redo.input),
		};
	});
}

export function previewUndoCategoryWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "category", token);
	const inverse = inverseOf(op, input);
	return previewWrite(caller, inverse.mutation, inverse.input);
}
