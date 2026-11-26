/**
 * The holders that name a category with no foreign key: income rules that
 * match a category (a text column) and the expected money in and pretend rows
 * of a budget draft (Json). Both live in a budget book, so they move only
 * where the caller edits the book (their own personal book, the one every
 * rule and draft write goes through).
 */
import {
	type DraftChange,
	moveDraftCategory,
	restoreDraftCategory,
} from "@retrospend/domain/category-merge/plan";
import { CategoryMergeRefusal } from "@retrospend/domain/category-merge/refusals";
import type { Prisma } from "~prisma";
import { findPersonalBook } from "../envelope/inputs";
import {
	groupByStamp,
	type HolderAdapter,
	heldCount,
	type Stamped,
	staleUndo,
	swapStamped,
} from "./holder";

/**
 * Income rules that match the category. One in a book the caller does not
 * edit, or any with no target to move to, refuses the merge: a rule that
 * silently stopped matching would send money to the wrong envelope.
 */
export const incomeRuleHolder: HolderAdapter<Stamped> = {
	async move(c) {
		const rules = await c.tx.incomeRule.findMany({
			where: { matchKind: "CATEGORY", matchValue: c.sourceId },
			select: { id: true, bookId: true },
		});
		if (rules.length === 0)
			return { held: { stamps: [] }, moved: 0, dropped: 0 };
		const book = await findPersonalBook(c.tx, c.userId);
		if (!c.targetId || rules.some((r) => r.bookId !== book?.id))
			throw new CategoryMergeRefusal("category_income_rule");
		const ids = rules.map((r) => r.id);
		const held = groupByStamp(
			await c.tx.incomeRule.updateManyAndReturn({
				where: { id: { in: ids } },
				data: { matchValue: c.targetId, updatedAt: c.stamp },
				select: { id: true, updatedAt: true },
			}),
		);
		return { held, moved: heldCount(held), dropped: 0 };
	},
	restore: (c, held) =>
		swapStamped(held, (chunk, stamp) =>
			c.tx.incomeRule.updateMany({
				where: {
					id: { in: chunk },
					matchKind: "CATEGORY",
					matchValue: c.targetId,
					updatedAt: stamp,
				},
				data: { matchValue: c.sourceId, updatedAt: c.stamp },
			}),
		),
};

export interface DraftHeld {
	/** Each draft with the stamp it stored, which the undo's compare names. */
	readonly drafts: readonly {
		id: string;
		changed: DraftChange;
		stamp: string;
	}[];
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

/** Every draft of the caller's book, whatever its status, so none keeps naming a category that is gone. */
export const draftHolder: HolderAdapter<DraftHeld> = {
	async move(c) {
		const book = await findPersonalBook(c.tx, c.userId);
		const drafts = book
			? await c.tx.budgetDraft.findMany({
					where: { bookId: book.id },
					select: { id: true, expectedIn: true, pretend: true },
				})
			: [];
		const held: DraftHeld["drafts"][number][] = [];
		for (const d of drafts) {
			const moved = moveDraftCategory(d, c.sourceId, c.targetId);
			if (!moved) continue;
			const stored = await c.tx.budgetDraft.update({
				where: { id: d.id },
				data: {
					expectedIn: asJson(moved.next.expectedIn),
					pretend: asJson(moved.next.pretend),
					updatedAt: c.stamp,
				},
				select: { updatedAt: true },
			});
			held.push({
				id: d.id,
				changed: moved.changed,
				stamp: stored.updatedAt.toISOString(),
			});
		}
		return {
			held: { drafts: held },
			moved: held.length,
			dropped: 0,
		};
	},
	async restore(c, held) {
		for (const d of held.drafts) {
			const draft = await c.tx.budgetDraft.findFirst({
				where: { id: d.id },
				select: { expectedIn: true, pretend: true },
			});
			if (!draft) throw staleUndo();
			const back = restoreDraftCategory(draft, d.changed, c.sourceId);
			const { count } = await c.tx.budgetDraft.updateMany({
				where: { id: d.id, updatedAt: new Date(d.stamp) },
				data: {
					expectedIn: asJson(back.expectedIn),
					pretend: asJson(back.pretend),
					updatedAt: c.stamp,
				},
			});
			if (count !== 1) throw staleUndo();
		}
	},
};
