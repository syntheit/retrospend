import type {
	CategoryDto,
	CursorQuery,
	createCategorySchema,
	patchCategorySchema,
} from "@retrospend/api-contract";
import { categoryTone } from "@retrospend/domain/category-tone";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	createCategoryWrite,
	recreateCategory,
	uncreateCategory,
} from "~/server/services/category/create.mutation";
import {
	editCategory,
	revertCategoryEdit,
} from "~/server/services/category/edit.mutation";
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
	getCategory,
	listCategoriesByName,
} from "~/server/services/category.service";
import { forUser } from "~/server/services/preview";
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

const uncreateOp = "category.uncreate";
const recreateOp = "category.recreate";
const revertOp = "category.revert";

type Fields = z.infer<typeof createCategorySchema>;

/** The create input as the mutation takes it (the wire's kind is lower case). */
function createInput(input: Fields) {
	const { kind, ...rest } = input;
	return {
		...rest,
		...(kind ? { kind: kind === "income" ? ("INCOME" as const) : ("EXPENSE" as const) } : {}),
	};
}

/** The edit as the mutation takes it: the fields that change, and the guard apart. */
function editInput(id: string, input: Omit<z.infer<typeof patchCategorySchema>, "id">) {
	const { expectedVersion, ...changes } = input;
	return { id, changes, expectedVersion };
}

/** A category as a write answers it: the row and the token that takes the write back. */
function written(row: CategoryRow, undo: string) {
	return { ...toCategory(row), undo };
}

/** The token that puts an edit back: the stash holds the replaced fields, the version is the one the edit left. */
const revertToken = (
	caller: Caller,
	done: { category: CategoryRow; stash: string },
) =>
	undoFor(caller, "category", revertOp, {
		id: done.category.id,
		stash: done.stash,
		version: done.category.version,
	});

export async function addCategory(caller: Caller, input: Fields) {
	const done = await applyWrite(caller, createCategoryWrite, createInput(input));
	return written(
		done.category,
		undoFor(caller, "category", uncreateOp, { id: done.category.id }),
	);
}

export async function previewAddCategory(caller: Caller, input: Fields) {
	const preview = await forUser(caller.principal.userId).preview(
		createCategoryWrite,
		createInput(input),
	);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "category.create" as const,
			id: preview.value.category.id,
			version: preview.value.category.version,
		},
	};
}

export async function changeCategory(
	caller: Caller,
	id: string,
	changes: Omit<z.infer<typeof patchCategorySchema>, "id">,
) {
	const done = await applyWrite(caller, editCategory, editInput(id, changes));
	return written(done.category, revertToken(caller, done));
}

export async function previewChangeCategory(
	caller: Caller,
	id: string,
	changes: Omit<z.infer<typeof patchCategorySchema>, "id">,
) {
	const preview = await forUser(caller.principal.userId).preview(
		editCategory,
		editInput(id, changes),
	);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "category.update" as const,
			id: preview.value.category.id,
			version: preview.value.category.version,
		},
	};
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

/** The id of the category an undo or a redo acted on, whatever shape its mutation answers. */
function idOfDone(value: unknown): string {
	const done = value as { id?: string; category?: { id: string } };
	return (done.id ?? done.category?.id) as string;
}

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
	if (op === uncreateOp) {
		return {
			mutation: uncreateCategory as MoneyMutation<unknown, unknown>,
			input,
			redo: (v: unknown) => ({
				op: recreateOp,
				input: { stash: (v as { stash: string }).stash },
			}),
		};
	}
	if (op === recreateOp) {
		return {
			mutation: recreateCategory as MoneyMutation<unknown, unknown>,
			input,
			redo: (v: unknown) => ({ op: uncreateOp, input: { id: idOfDone(v) } }),
		};
	}
	if (op === revertOp) {
		return {
			mutation: revertCategoryEdit as MoneyMutation<unknown, unknown>,
			input,
			redo: (v: unknown) => {
				const done = v as { category: CategoryRow; stash: string };
				return {
					op: revertOp,
					input: {
						id: done.category.id,
						stash: done.stash,
						version: done.category.version,
					},
				};
			},
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
			id: idOfDone(value),
			redo: undoFor(caller, "category", redo.op, redo.input),
		};
	});
}

export function previewUndoCategoryWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "category", token);
	const inverse = inverseOf(op, input);
	return previewWrite(caller, inverse.mutation, inverse.input);
}
