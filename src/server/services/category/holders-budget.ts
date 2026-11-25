/**
 * The holders that carry a unique key with the category: budgets (one per
 * user, category and period), envelope links (one per book and category) and
 * the analytics preference (one per user and category). Where the target
 * already has the row the source's goes (or all of them, with no target) and
 * the undo recreates what was dropped; the rest move to the target. The
 * decisions are the domain's (category-merge/plan.ts).
 */
import {
	planBudgets,
	planLinks,
	planPreference,
} from "@retrospend/domain/category-merge/plan";
import { type BudgetType, Prisma } from "~prisma";
import { type HolderAdapter, type Stamped, staleUndo, swapAll } from "./holder";

export interface BudgetHeld extends Stamped {
	readonly dropped: readonly {
		readonly id: string;
		readonly amount: string;
		readonly currency: string;
		readonly period: string;
		readonly isRollover: boolean;
		readonly rolloverAmount: string;
		readonly pegToActual: boolean;
		readonly type: BudgetType;
		readonly createdAt: string;
	}[];
}

export const budgetHolder: HolderAdapter<BudgetHeld> = {
	async move(c) {
		const mine = await c.tx.budget.findMany({
			where: { userId: c.userId, categoryId: c.sourceId },
		});
		const theirs = c.targetId
			? new Set(
					(
						await c.tx.budget.findMany({
							where: { userId: c.userId, categoryId: c.targetId },
							select: { period: true },
						})
					).map((b) => b.period.getTime()),
				)
			: null;
		const plan = planBudgets(
			mine.map((b) => ({ id: b.id, period: b.period.getTime() })),
			theirs,
		);
		const dropped = mine.filter((b) => plan.drop.includes(b.id));
		await c.tx.budget.deleteMany({
			where: { userId: c.userId, id: { in: plan.drop } },
		});
		await c.tx.budget.updateMany({
			where: { userId: c.userId, id: { in: plan.move } },
			data: { categoryId: c.targetId, updatedAt: c.stamp },
		});
		return {
			held: {
				ids: plan.move,
				stamp: c.stamp.toISOString(),
				dropped: dropped.map((b) => ({
					id: b.id,
					amount: b.amount.toFixed(),
					currency: b.currency,
					period: b.period.toISOString(),
					isRollover: b.isRollover,
					rolloverAmount: b.rolloverAmount.toFixed(),
					pegToActual: b.pegToActual,
					type: b.type,
					createdAt: b.createdAt.toISOString(),
				})),
			},
			moved: plan.move.length,
			dropped: dropped.length,
		};
	},
	async restore(c, held) {
		// A budget filed under the category since the undo began is something the
		// recreated rows would collide with, so the undo is refused.
		const filed = await c.tx.budget.count({
			where: { userId: c.userId, categoryId: c.sourceId },
		});
		if (filed > 0) throw staleUndo();
		await swapAll(held.ids, (chunk) =>
			c.tx.budget.updateMany({
				where: {
					userId: c.userId,
					id: { in: chunk },
					categoryId: c.targetId,
					updatedAt: new Date(held.stamp),
				},
				data: { categoryId: c.sourceId, updatedAt: c.stamp },
			}),
		);
		if (held.dropped.length === 0) return;
		await c.tx.budget.createMany({
			data: held.dropped.map((b) => ({
				id: b.id,
				userId: c.userId,
				categoryId: c.sourceId,
				amount: new Prisma.Decimal(b.amount),
				currency: b.currency,
				period: new Date(b.period),
				isRollover: b.isRollover,
				rolloverAmount: new Prisma.Decimal(b.rolloverAmount),
				pegToActual: b.pegToActual,
				type: b.type,
				createdAt: new Date(b.createdAt),
			})),
		});
	},
};

export interface LinkHeld {
	readonly moved: readonly { id: string; envelopeId: string }[];
	readonly dropped: readonly {
		id: string;
		bookId: string;
		envelopeId: string;
		createdAt: string;
	}[];
	/** Where the source's rows land now, per book. */
	readonly rerouted: readonly { bookId: string; from: string; to: string }[];
}

export const envelopeLinkHolder: HolderAdapter<LinkHeld> = {
	async move(c) {
		const mine = await c.tx.envelopeCategory.findMany({
			where: { categoryId: c.sourceId },
		});
		const theirs = c.targetId
			? await c.tx.envelopeCategory.findMany({
					where: { categoryId: c.targetId },
				})
			: null;
		const books = await c.tx.budgetBook.findMany({
			where: { id: { in: mine.map((l) => l.bookId) } },
			select: { id: true, defaultEnvelopeId: true },
		});
		const defaults = new Map(
			books.flatMap((b) =>
				b.defaultEnvelopeId ? [[b.id, b.defaultEnvelopeId] as const] : [],
			),
		);
		const plan = planLinks(mine, theirs, defaults);
		const dropped = mine.filter((l) => plan.drop.includes(l.id));
		await c.tx.envelopeCategory.deleteMany({
			where: { id: { in: plan.drop } },
		});
		if (c.targetId && plan.move.length > 0)
			await c.tx.envelopeCategory.updateMany({
				where: { id: { in: plan.move } },
				data: { categoryId: c.targetId },
			});
		return {
			held: {
				moved: mine
					.filter((l) => plan.move.includes(l.id))
					.map((l) => ({ id: l.id, envelopeId: l.envelopeId })),
				dropped: dropped.map((l) => ({
					id: l.id,
					bookId: l.bookId,
					envelopeId: l.envelopeId,
					createdAt: l.createdAt.toISOString(),
				})),
				rerouted: plan.rerouted,
			},
			moved: plan.move.length,
			dropped: dropped.length,
		};
	},
	async restore(c, held) {
		// A link is a row with no stamp: it must still be the one the move left.
		if (held.moved.length > 0 && !c.targetId) throw staleUndo();
		for (const link of held.moved) {
			if (!c.targetId) break;
			const { count } = await c.tx.envelopeCategory.updateMany({
				where: {
					id: link.id,
					categoryId: c.targetId,
					envelopeId: link.envelopeId,
				},
				data: { categoryId: c.sourceId },
			});
			if (count !== 1) throw staleUndo();
		}
		for (const link of held.dropped) {
			// An envelope archived and removed since cannot take its category back.
			const envelope = await c.tx.envelope.count({
				where: { id: link.envelopeId, bookId: link.bookId },
			});
			if (envelope !== 1) throw staleUndo();
			await c.tx.envelopeCategory.create({
				data: {
					id: link.id,
					bookId: link.bookId,
					envelopeId: link.envelopeId,
					categoryId: c.sourceId,
					createdAt: new Date(link.createdAt),
				},
			});
		}
	},
};

export interface PreferenceHeld {
	readonly moved: string | null;
	readonly dropped: { id: string; isFlexible: boolean } | null;
}

export const preferenceHolder: HolderAdapter<PreferenceHeld> = {
	async move(c) {
		const mine = await c.tx.analyticsCategoryPreference.findFirst({
			where: { userId: c.userId, categoryId: c.sourceId },
		});
		const theirs = c.targetId
			? await c.tx.analyticsCategoryPreference.count({
					where: { userId: c.userId, categoryId: c.targetId },
				})
			: 0;
		const what = planPreference(mine?.id ?? null, theirs > 0, !!c.targetId);
		if (!mine || what === "none")
			return { held: { moved: null, dropped: null }, moved: 0, dropped: 0 };
		if (what === "drop") {
			await c.tx.analyticsCategoryPreference.delete({ where: { id: mine.id } });
			return {
				held: {
					moved: null,
					dropped: { id: mine.id, isFlexible: mine.isFlexible },
				},
				moved: 0,
				dropped: 1,
			};
		}
		await c.tx.analyticsCategoryPreference.update({
			where: { id: mine.id },
			data: { categoryId: c.targetId as string },
		});
		return { held: { moved: mine.id, dropped: null }, moved: 1, dropped: 0 };
	},
	async restore(c, held) {
		if (held.moved) {
			if (!c.targetId) throw staleUndo();
			const { count } = await c.tx.analyticsCategoryPreference.updateMany({
				where: { id: held.moved, userId: c.userId, categoryId: c.targetId },
				data: { categoryId: c.sourceId },
			});
			if (count !== 1) throw staleUndo();
		}
		if (held.dropped)
			await c.tx.analyticsCategoryPreference.create({
				data: {
					id: held.dropped.id,
					userId: c.userId,
					categoryId: c.sourceId,
					isFlexible: held.dropped.isFlexible,
				},
			});
	},
};
