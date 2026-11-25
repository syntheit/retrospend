/**
 * Deleting a category, and merging it into another, as one money mutation
 * (R30, R15): the preview is the same write rolled back, and one undo brings
 * the category and everything that moved back.
 *
 * - category.merge: every row the category holds goes to the target (or to
 *   no category, for a delete), by the domain's holder list, then the
 *   category goes. Refused, with a named code, for an expense and an income
 *   category, when a closed month would route the rows to another envelope,
 *   and when an income rule the caller cannot change names it.
 * - category.restore: the undo. The category row and what each holder moved
 *   or dropped stay in the sealed undo stash (the name is user text, so it
 *   never rides in the readable token); the undo recreates the category
 *   through the one insert, then puts each holder back, and is refused as a
 *   whole, changing nothing, when anything changed since.
 */
import type { HolderId } from "@retrospend/domain/category-merge/holders";
import {
	checkMergeKinds,
	type Reroute,
} from "@retrospend/domain/category-merge/plan";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "@retrospend/domain/envelope/verdict";
import { TRPCError } from "@trpc/server";
import type { CategoryColor, CategoryKind } from "~prisma";
import { asNameTaken, insertCategory } from "../category.service";
import { EXPENSE_FIGURES } from "../entry/expense.mutation";
import { invalidUndo, putUndoStash, takeUndoStash } from "../entry/undo-stash";
import { FIGURE_BUDGET_HOLDS } from "../envelope/figures";
import { forgetMonthViews } from "../envelope/month-read";
import type { MoneyMutation } from "../preview/types";
import { assertNoClosedMonthChange } from "./closed-months";
import { type MergeCtx, staleUndo } from "./holder";
import { HOLDERS, MOVE_ORDER } from "./holders";

/** Spent does not move (kinds match, flags stay); the budget pool moves when envelope links do. */
const TOUCHES = [
	...EXPENSE_FIGURES,
	FIGURE_NOT_PLANNED_YET,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_BUDGET_HOLDS,
];

export interface MergeInput {
	readonly id: string;
	/** Null deletes the category and leaves its rows uncategorized. */
	readonly targetId: string | null;
}

export interface CategoryMerged {
	readonly id: string;
	readonly targetId: string | null;
	readonly mode: "merge" | "delete";
	/** What each holder moved to the target and what it dropped (a clash or a delete). */
	readonly counts: Readonly<
		Record<HolderId, { moved: number; dropped: number }>
	>;
	/** Every envelope change of rows in a book: whose rows, from where, to where. */
	readonly rerouted: readonly Reroute[];
	/** Shared expenses the caller may not write: they go to no category with the category, and the undo does not bring them back. */
	readonly setToNone: number;
	/** category.restore with this stash puts everything back. */
	readonly stash: string;
}

interface Stash {
	readonly v: 1;
	readonly category: {
		readonly id: string;
		readonly name: string;
		readonly color: CategoryColor;
		readonly icon: string | null;
		readonly isFixed: boolean;
		readonly excludeByDefault: boolean;
		readonly kind: CategoryKind;
	};
	readonly targetId: string | null;
	readonly held: Partial<Record<HolderId, unknown>>;
}

const notFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Category not found" });

/** The category row, locked: no row can be filed under it or taken from it until this transaction ends. */
async function lockedCategory(tx: MergeCtx["tx"], userId: string, id: string) {
	const [row] = await tx.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM "category" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
	if (!row) throw notFound();
	return tx.category.findFirstOrThrow({ where: { id, userId } });
}

async function checkedTarget(
	tx: MergeCtx["tx"],
	userId: string,
	input: MergeInput,
) {
	if (!input.targetId) return null;
	if (input.targetId === input.id)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A category cannot be merged into itself",
		});
	const target = await tx.category.findFirst({
		where: { id: input.targetId, userId },
	});
	if (!target)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Replacement category not found",
		});
	return target;
}

export const mergeCategories: MoneyMutation<MergeInput, CategoryMerged> = {
	id: "category.merge",
	touches: TOUCHES,
	run: async (tx, input, actor) => {
		const userId = actor.userId;
		const source = await lockedCategory(tx, userId, input.id);
		const target = await checkedTarget(tx, userId, input);
		checkMergeKinds(source, target);
		const c: MergeCtx = {
			tx,
			userId,
			sourceId: source.id,
			targetId: target?.id ?? null,
			stamp: new Date(),
		};
		await assertNoClosedMonthChange(c);
		const held: Partial<Record<HolderId, unknown>> = {};
		const counts = {} as Record<HolderId, { moved: number; dropped: number }>;
		let rerouted: CategoryMerged["rerouted"] = [];
		let setToNone = 0;
		for (const id of MOVE_ORDER) {
			const done = await HOLDERS[id].move(c);
			held[id] = done.held;
			counts[id] = { moved: done.moved, dropped: done.dropped };
			const extra = done.held as {
				rerouted?: CategoryMerged["rerouted"];
				setToNone?: number;
			};
			rerouted = extra.rerouted ?? rerouted;
			setToNone += extra.setToNone ?? 0;
		}
		forgetMonthViews(tx);
		await tx.category.delete({ where: { id: source.id, userId } });
		const stash = await putUndoStash(tx, userId, {
			v: 1,
			category: {
				id: source.id,
				name: source.name,
				color: source.color,
				icon: source.icon,
				isFixed: source.isFixed,
				excludeByDefault: source.excludeByDefault,
				kind: source.kind,
			},
			targetId: c.targetId,
			held,
		} satisfies Stash);
		return {
			value: {
				id: source.id,
				targetId: c.targetId,
				mode: c.targetId ? "merge" : "delete",
				counts,
				rerouted,
				setToNone,
				stash,
			},
			undo: {
				kind: "revert",
				mutation: "category.restore",
				rows: [{ table: "category", id: source.id }],
			},
		};
	},
};

export interface RestoreInput {
	readonly stash: string;
}

/** The undo of category.merge. */
export const restoreCategory: MoneyMutation<
	RestoreInput,
	Pick<CategoryMerged, "id" | "targetId" | "mode">
> = {
	id: "category.restore",
	touches: TOUCHES,
	run: async (tx, input, actor) => {
		const userId = actor.userId;
		const body = await takeUndoStash<Stash>(tx, userId, input.stash);
		if (body.v !== 1 || !body.category) throw invalidUndo();
		const target = body.targetId
			? await tx.category.findFirst({
					where: { id: body.targetId, userId },
					select: { id: true },
				})
			: null;
		// What the rows moved into is gone: there is nothing to take them back from.
		if (body.targetId && !target) throw staleUndo();
		try {
			await insertCategory(tx, userId, body.category);
		} catch (error) {
			throw asNameTaken(error);
		}
		const c: MergeCtx = {
			tx,
			userId,
			sourceId: body.category.id,
			targetId: body.targetId,
			stamp: new Date(),
		};
		for (const id of [...MOVE_ORDER].reverse()) {
			if (!(id in body.held)) throw invalidUndo();
			await HOLDERS[id].restore(c, body.held[id]);
		}
		forgetMonthViews(tx);
		return {
			value: {
				id: body.category.id,
				targetId: body.targetId,
				mode: body.targetId ? "merge" : "delete",
			},
			undo: {
				kind: "revert",
				mutation: "category.merge",
				rows: [{ table: "category", id: body.category.id }],
			},
		};
	},
};
