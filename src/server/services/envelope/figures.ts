/**
 * Budget figures (IMPLEMENTATION §2.4): the envelope numbers the product
 * names, each with one definition, read for the current budget month.
 *
 * - budget.notPlannedYet: the pool (To assign; "Not planned yet" outside
 *   Every dollar, D-owner-2026-10-22f). Signed: negative when more is
 *   planned than there is.
 * - budget.leftToSpend: Σ Left of the Spending group minus a negative pool
 *   (D-owner-2026-10-22d).
 * - budget.leftThisWeek: Σ Left this week of weekly envelopes (SPEC §6.1).
 * - envelope.left: one envelope's Left, narrowed by `envelopeId`.
 *
 * Every one is unavailable (null) without a book or while a rate is
 * missing (R14: "Incomplete", never a guess).
 */
import type {
	FigureDb,
	FigureDefinition,
	Money,
} from "~/server/figures/registry";
import { monthViewIn } from "./month-read";
import {
	FIGURE_LEFT_THIS_WEEK,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

async function current(db: FigureDb, userId: string) {
	const view = await monthViewIn(db, userId, new Date());
	return view && !view.dto.incomplete ? view : null;
}

const inBook = (minor: number, currency: string): Money => ({
	minor,
	currency,
});

export const notPlannedYetFigure: FigureDefinition = {
	id: FIGURE_NOT_PLANNED_YET,
	scope: [],
	compute: async (db, scope) => {
		const v = await current(db, scope.userId);
		return v ? v.dto.toAssign.amount : null;
	},
};

export const leftToSpendFigure: FigureDefinition = {
	id: FIGURE_LEFT_TO_SPEND,
	scope: [],
	compute: async (db, scope) => {
		const v = await current(db, scope.userId);
		return v ? v.dto.leftToSpend.left : null;
	},
};

export const leftThisWeekFigure: FigureDefinition = {
	id: FIGURE_LEFT_THIS_WEEK,
	scope: [],
	compute: async (db, scope) => {
		const v = await current(db, scope.userId);
		if (!v) return null;
		const weekly = v.dto.groups
			.flatMap((g) => g.envelopes)
			.filter((e) => e.leftThisWeek);
		if (weekly.length === 0) return null;
		return inBook(
			weekly.reduce((t, e) => t + (e.leftThisWeek?.amount.minor ?? 0), 0),
			v.dto.book.currency,
		);
	},
};

export const envelopeLeftFigure: FigureDefinition = {
	id: "envelope.left",
	scope: ["envelopeId"],
	compute: async (db, scope) => {
		if (!scope.envelopeId) return null;
		const v = await current(db, scope.userId);
		const row = v?.dto.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === scope.envelopeId);
		return row ? row.left : null;
	},
};

export const budgetFigures = [
	notPlannedYetFigure,
	leftToSpendFigure,
	leftThisWeekFigure,
	envelopeLeftFigure,
];
