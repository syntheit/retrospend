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
 * - budget.leftInLimits: Limits, Σ Left of the envelopes with a limit.
 * - budget.holds: To assign + Σ Left + next month's assigned, what the
 *   bank should hold (reconcile).
 * - budget.heldForOthers: what the budget holds for money people owe you
 *   (the splits replay's open basis, SPEC §5.8): it is out of To assign
 *   until they pay or you forgive.
 *
 * Every one is unavailable (null) without a book or while a rate is
 * missing (R14: "Incomplete", never a guess).
 */
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
	Money,
} from "~/server/figures/registry";
import { budgetHolds } from "./bank";
import { forgetMonthViews, monthViewIn } from "./month-read";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_THIS_WEEK,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

export const FIGURE_HELD_FOR_OTHERS = "budget.heldForOthers";
export const FIGURE_BUDGET_HOLDS = "budget.holds";

/**
 * The current month, read once per figure pass. Each pass reads anew: a
 * preview's after side must see the write it wraps, and writers outside the
 * envelope services (a shared expense, a payment) do not clear the
 * transaction's month view memo.
 */
async function current(db: FigureDb, userId: string, pass?: FigurePass) {
	const read = () => {
		forgetMonthViews(db);
		return monthViewIn(db, userId, new Date());
	};
	const view = await (pass
		? pass.once(`budget.month:${userId}`, read)
		: read());
	return view && !view.dto.incomplete ? view : null;
}

const inBook = (minor: number, currency: string): Money => ({
	minor,
	currency,
});

export const notPlannedYetFigure: FigureDefinition = {
	id: FIGURE_NOT_PLANNED_YET,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
		return v ? v.dto.toAssign.amount : null;
	},
};

export const leftToSpendFigure: FigureDefinition = {
	id: FIGURE_LEFT_TO_SPEND,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
		return v ? v.dto.leftToSpend.left : null;
	},
};

export const leftThisWeekFigure: FigureDefinition = {
	id: FIGURE_LEFT_THIS_WEEK,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
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
	compute: async (db, scope, pass) => {
		if (!scope.envelopeId) return null;
		const v = await current(db, scope.userId, pass);
		const row = v?.dto.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === scope.envelopeId);
		return row ? row.left : null;
	},
};

export const heldForOthersFigure: FigureDefinition = {
	id: FIGURE_HELD_FOR_OTHERS,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
		return v ? v.dto.owed.held : null;
	},
};

/** Limits (SPEC §6.1): Σ Left of the envelopes with a limit; null in other styles. */
export const leftInLimitsFigure: FigureDefinition = {
	id: FIGURE_LEFT_IN_LIMITS,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
		const lead = v?.dto.verdict.lead;
		return lead?.kind === "LEFT_IN_LIMITS" ? lead.amount : null;
	},
};

/** What the budget holds: To assign + Σ Left + next month's assigned (reconcile, SPEC §5.11). */
export const budgetHoldsFigure: FigureDefinition = {
	id: FIGURE_BUDGET_HOLDS,
	scope: [],
	compute: async (db, scope, pass) => {
		const v = await current(db, scope.userId, pass);
		return v ? inBook(budgetHolds(v), v.dto.book.currency) : null;
	},
};

export const budgetFigures = [
	notPlannedYetFigure,
	leftToSpendFigure,
	leftThisWeekFigure,
	leftInLimitsFigure,
	envelopeLeftFigure,
	heldForOthersFigure,
	budgetHoldsFigure,
];
