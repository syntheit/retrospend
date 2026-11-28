/**
 * Editing a category, and putting the edit back, as money mutations (R30,
 * R15): the same preview and undo as every write, one object behind tRPC and
 * /api/v1.
 *
 * - category.update: the fields named change through updateCategoryIn, which
 *   owns the version bump and the expectedVersion filter. The values it
 *   replaced go to the sealed undo stash (the previous name is user text and
 *   never rides in the readable token).
 * - category.revert: the undo, and the redo of itself. It puts the stashed
 *   fields back as a write (so the version moves, and a device sees the
 *   change) and only while the category still has the version the edit left;
 *   any other version is category_changed and nothing is written.
 */
import { invalidUndo, putUndoStash, takeUndoStash } from "../entry/undo-stash";
import type { MoneyMutation } from "../preview/types";
import {
	type CategoryInput,
	type CategoryRow,
	updateCategoryIn,
} from "../category.service";
import { lockedCategory } from "./lock";
import type { Prisma } from "~prisma";

export interface EditCategoryInput {
	readonly id: string;
	/** Only what changes: a `name` sent is a rename (the server never compares names). */
	readonly changes: Partial<CategoryInput>;
	/** The version the caller read; another version is category_changed. */
	readonly expectedVersion?: number;
}

export interface CategoryEdited {
	readonly category: CategoryRow;
	/** category.revert with this stash and `category.version` puts the replaced fields back. */
	readonly stash: string;
}

const FIELDS = ["name", "color", "icon", "excludeByDefault"] as const;

/** The stash of an edit: the values the edit replaced, only for the fields it named. */
interface EditStash {
	readonly v: 1;
	readonly id: string;
	readonly fields: Partial<CategoryInput>;
}

/** Only the editable fields that are named: nothing else a transport hands over reaches the write. */
const named = (changes: Partial<CategoryInput>) =>
	Object.fromEntries(
		FIELDS.flatMap((key) =>
			changes[key] === undefined ? [] : [[key, changes[key]]],
		),
	) as Partial<CategoryInput>;

async function applyEdit(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
	changes: Partial<CategoryInput>,
	expectedVersion: number | undefined,
): Promise<CategoryEdited> {
	// Locked first: what the stash keeps is what the update replaces.
	const before = await lockedCategory(tx, userId, id);
	const fields = named(changes);
	const category = await updateCategoryIn(tx, userId, id, fields, {
		expectedVersion,
	});
	const replaced = Object.fromEntries(
		Object.keys(fields).map((key) => [key, before[key as keyof typeof before]]),
	);
	const stash = await putUndoStash(tx, userId, {
		v: 1,
		id,
		fields: replaced,
	} satisfies EditStash);
	return { category, stash };
}

const undoOf = (id: string) =>
	({
		kind: "revert",
		mutation: "category.revert",
		rows: [{ table: "category", id }],
	}) as const;

export const editCategory: MoneyMutation<EditCategoryInput, CategoryEdited> = {
	id: "category.update",
	touches: [],
	run: async (tx, input, actor) => ({
		value: await applyEdit(
			tx,
			actor.userId,
			input.id,
			input.changes,
			input.expectedVersion,
		),
		undo: undoOf(input.id),
	}),
};

export interface RevertInput {
	readonly id: string;
	readonly stash: string;
	/** The version the edit left; the revert runs only on it. */
	readonly version: number;
}

export const revertCategoryEdit: MoneyMutation<RevertInput, CategoryEdited> = {
	id: "category.revert",
	touches: [],
	run: async (tx, input, actor) => {
		const body = await takeUndoStash<EditStash>(tx, actor.userId, input.stash);
		if (body.v !== 1 || body.id !== input.id || typeof body.fields !== "object")
			throw invalidUndo();
		return {
			value: await applyEdit(
				tx,
				actor.userId,
				input.id,
				body.fields,
				input.version,
			),
			undo: undoOf(input.id),
		};
	},
};
