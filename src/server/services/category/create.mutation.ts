/**
 * Making a category, and taking the make back, as money mutations (R30,
 * R15). A category moves no figure, but a device queues the write, so it has
 * the same preview (the real insert in a rolled-back transaction) and undo
 * as every write, and tRPC and /api/v1 call the same object.
 *
 * - category.create: one insert through insertCategory, which owns the
 *   client id (a taken one is id_taken), the name check and the name index.
 * - category.uncreate: the undo. It deletes the category only while nothing
 *   holds it; any holder refuses, as stale, before anything is deleted.
 * - category.recreate: the undo of that, back under its own id.
 *
 * Why the count in uncreate sees every holder. The category is locked
 * FOR UPDATE first, then every adapter in HOLDERS (the domain's HOLDER_IDS:
 * each foreign key to Category and each loose reference) counts the rows that
 * name it, drafts, preferences, budgets, envelope links and shares included.
 * The delete's foreign keys act on every row whether the caller can read it
 * or not, so the question is which rows can name a category that belongs to
 * the caller. Since the shared category owner fix (own.ts) every write refuses
 * a category that is not the writer's own, so such rows are the owner's own
 * writes: a shared expense they made (readable by them), or one they filed
 * under their own category as a person on its split or its project. That
 * second kind turns unreadable to them when they leave, and rows written
 * before the fix may name a category their writer did not own. Row level
 * security hides both from a count through the caller's client, so the
 * foreign-key holders count through category_holder_count
 * (20261127400000_category_holder_count), a definer function that answers only
 * for a category the caller owns. create-undo.pg.test.ts covers a shared
 * expense of a project the creator has left and a row of someone the caller
 * has no tie to: the count sees both and refuses.
 */
import type { CategoryKind } from "~prisma";
import {
	asNameTaken,
	type CategoryInput,
	type CategoryRow,
	insertCategory,
} from "../category.service";
import { invalidUndo, putUndoStash, takeUndoStash } from "../entry/undo-stash";
import type { MoneyMutation } from "../preview/types";
import { type MergeCtx, staleUndo } from "./holder";
import { HOLDERS, MOVE_ORDER } from "./holders";
import { lockedCategory } from "./lock";

export interface CreateCategoryInput extends CategoryInput {
	/** A client-made id (a uuid); a taken one is id_taken and nothing is written. */
	id?: string;
	kind?: CategoryKind;
}

export interface CategoryCreated {
	readonly category: CategoryRow;
}

export const createCategoryWrite: MoneyMutation<
	CreateCategoryInput,
	CategoryCreated
> = {
	id: "category.create",
	touches: [],
	run: async (tx, input, actor) => {
		let category: CategoryRow;
		try {
			category = await insertCategory(tx, actor.userId, input);
		} catch (error) {
			throw asNameTaken(error);
		}
		return {
			value: { category },
			undo: {
				kind: "revert",
				mutation: "category.uncreate",
				rows: [{ table: "category", id: category.id }],
			},
		};
	},
};

export interface UncreateInput {
	readonly id: string;
}

export interface CategoryUncreated {
	readonly id: string;
	/** category.recreate with this stash puts the category back. */
	readonly stash: string;
}

/** The sealed stash of a removed category: every column a recreate writes. */
interface CreatedStash {
	readonly v: 1;
	readonly category: {
		readonly id: string;
		readonly name: string;
		readonly color: CategoryRow["color"];
		readonly icon: string | null;
		readonly kind: CategoryKind;
		readonly excludeByDefault: boolean;
		readonly isFixed: boolean;
		readonly version: number;
	};
}

export const uncreateCategory: MoneyMutation<UncreateInput, CategoryUncreated> =
	{
		id: "category.uncreate",
		touches: [],
		run: async (tx, input, actor) => {
			const userId = actor.userId;
			const source = await lockedCategory(tx, userId, input.id);
			const c: MergeCtx = {
				tx,
				userId,
				sourceId: source.id,
				targetId: null,
				stamp: new Date(),
			};
			// Every count first: nothing is deleted while any holder names it.
			for (const holder of MOVE_ORDER)
				if ((await HOLDERS[holder].count(c)) > 0) throw staleUndo();
			await tx.category.delete({ where: { id: source.id, userId } });
			const stash = await putUndoStash(tx, userId, {
				v: 1,
				category: {
					id: source.id,
					name: source.name,
					color: source.color,
					icon: source.icon,
					kind: source.kind,
					excludeByDefault: source.excludeByDefault,
					isFixed: source.isFixed,
					version: source.version,
				},
			} satisfies CreatedStash);
			return {
				value: { id: source.id, stash },
				undo: {
					kind: "revert",
					mutation: "category.recreate",
					rows: [{ table: "category", id: source.id }],
				},
			};
		},
	};

export interface RecreateInput {
	readonly stash: string;
}

/** The undo of category.uncreate: the category back under its id, name and version. */
export const recreateCategory: MoneyMutation<RecreateInput, CategoryCreated> = {
	id: "category.recreate",
	touches: [],
	run: async (tx, input, actor) => {
		const body = await takeUndoStash<CreatedStash>(
			tx,
			actor.userId,
			input.stash,
		);
		if (
			body.v !== 1 ||
			!body.category ||
			!Number.isInteger(body.category.version)
		)
			throw invalidUndo();
		let category: CategoryRow;
		try {
			category = await insertCategory(tx, actor.userId, body.category);
		} catch (error) {
			throw asNameTaken(error);
		}
		return {
			value: { category },
			undo: {
				kind: "revert",
				mutation: "category.uncreate",
				rows: [{ table: "category", id: category.id }],
			},
		};
	},
};
