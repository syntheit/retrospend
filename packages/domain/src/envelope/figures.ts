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
 * - envelope.spent: what one envelope spent this month (positive), narrowed
 *   by `envelopeId`; spending and shares minus refunds, never Wealth moves.
 * - budget.moneyIn: money in through this month (income, moves from Wealth),
 *   from the same terms To assign is. The starting balance is not in it: it
 *   has its own term (startingMoney).
 * - budget.leftInLimits: Limits, Σ Left of the envelopes with a limit.
 * - budget.holds: To assign + Σ Left + next month's assigned, what the
 *   bank should hold (reconcile).
 * - budget.heldForOthers: what the budget holds for money people owe you
 *   (the splits replay's open basis, SPEC §5.8): it is out of To assign
 *   until they pay or you forgive.
 *
 * - budget.totalDebt: Σ liabilities today in H (SPEC §5.11).
 * - budget.planCost, budget.typicalIncome: plan cost and the usual income
 *   it is judged against (SPEC §5.13, §12.3).
 *
 * Every one is unavailable (null) without a book or while a rate is
 * missing (R14: "Incomplete", never a guess).
 */
import type { FigureDefinition, FigurePass } from "../figures/registry";
import type { Money } from "../money-minor";
import { budgetHoldsOf } from "./budget-holds";
import type { PayoffProjection, PlanCostDto } from "./dto";
import type { MonthRead } from "./month-read";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_THIS_WEEK,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

export const FIGURE_HELD_FOR_OTHERS = "budget.heldForOthers";
export const FIGURE_BUDGET_HOLDS = "budget.holds";
export const FIGURE_PLAN_COST = "budget.planCost";
export const FIGURE_TYPICAL_INCOME = "budget.typicalIncome";
export const FIGURE_TOTAL_DEBT = "budget.totalDebt";

/**
 * What the budget figures read, once per pass; each is null without a book or
 * while a rate is missing (R14). The server answers from Postgres
 * (prismaBudgetReads in server/services/envelope/figures.ts); a device answers
 * from its own store. The figure definitions only pick a number out of what
 * these return, so a figure means the same thing wherever it is computed.
 */
export interface BudgetReads<Db> {
	month(db: Db, userId: string, pass?: FigurePass): Promise<MonthRead | null>;
	plan(db: Db, userId: string, pass?: FigurePass): Promise<PlanCostDto | null>;
	debt(
		db: Db,
		userId: string,
		pass?: FigurePass,
	): Promise<PayoffProjection | null>;
}

const inBook = (minor: number, currency: string): Money => ({
	minor,
	currency,
});

export function createBudgetFigures<Db>(
	reads: BudgetReads<Db>,
): FigureDefinition<Db>[] {
	const notPlannedYetFigure: FigureDefinition<Db> = {
		id: FIGURE_NOT_PLANNED_YET,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			return v ? v.dto.toAssign.amount : null;
		},
	};

	const leftToSpendFigure: FigureDefinition<Db> = {
		id: FIGURE_LEFT_TO_SPEND,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			return v ? v.dto.leftToSpend.left : null;
		},
	};

	const leftThisWeekFigure: FigureDefinition<Db> = {
		id: FIGURE_LEFT_THIS_WEEK,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
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

	const envelopeLeftFigure: FigureDefinition<Db> = {
		id: "envelope.left",
		scope: ["envelopeId"],
		compute: async (db, scope, pass) => {
			if (!scope.envelopeId) return null;
			const v = await reads.month(db, scope.userId, pass);
			const row = v?.dto.groups
				.flatMap((g) => g.envelopes)
				.find((e) => e.id === scope.envelopeId);
			return row ? row.left : null;
		},
	};

	/** Money in this month: what came into the budget (income, starting money, moves from Wealth), the rail's Money in. */
	const moneyInFigure: FigureDefinition<Db> = {
		id: "budget.moneyIn",
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			return v ? v.dto.toAssign.terms.moneyIn : null;
		},
	};

	const envelopeSpentFigure: FigureDefinition<Db> = {
		id: "envelope.spent",
		scope: ["envelopeId"],
		compute: async (db, scope, pass) => {
			if (!scope.envelopeId) return null;
			const v = await reads.month(db, scope.userId, pass);
			const row = v?.dto.groups
				.flatMap((g) => g.envelopes)
				.find((e) => e.id === scope.envelopeId);
			return row ? row.spent : null;
		},
	};

	const heldForOthersFigure: FigureDefinition<Db> = {
		id: FIGURE_HELD_FOR_OTHERS,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			return v ? v.dto.owed.held : null;
		},
	};

	/** Limits (SPEC §6.1): Σ Left of the envelopes with a limit; null in other styles. */
	const leftInLimitsFigure: FigureDefinition<Db> = {
		id: FIGURE_LEFT_IN_LIMITS,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			const lead = v?.dto.verdict.lead;
			return lead?.kind === "LEFT_IN_LIMITS" ? lead.amount : null;
		},
	};

	/** What the budget holds: To assign + Σ Left + next month's assigned (reconcile, SPEC §5.11). */
	const budgetHoldsFigure: FigureDefinition<Db> = {
		id: FIGURE_BUDGET_HOLDS,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.month(db, scope.userId, pass);
			return v
				? inBook(budgetHoldsOf(v.loaded.input), v.dto.book.currency)
				: null;
		},
	};

	/** Plan cost (SPEC §5.13, E6): Σ monthly-equivalent targets this month; null with a rate missing. */
	const planCostFigure: FigureDefinition<Db> = {
		id: FIGURE_PLAN_COST,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.plan(db, scope.userId, pass);
			return v ? v.cost : null;
		},
	};

	/** Typical income (SPEC §12.3): median budget income of the last 3 closed months; null with none. */
	const typicalIncomeFigure: FigureDefinition<Db> = {
		id: FIGURE_TYPICAL_INCOME,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.plan(db, scope.userId, pass);
			return v ? v.typicalIncome : null;
		},
	};

	/** Total debt today in the book currency (SPEC §5.11 debt hero); null with a rate missing. */
	const totalDebtFigure: FigureDefinition<Db> = {
		id: FIGURE_TOTAL_DEBT,
		scope: [],
		compute: async (db, scope, pass) => {
			const v = await reads.debt(db, scope.userId, pass);
			return v ? v.totalDebt : null;
		},
	};

	return [
		notPlannedYetFigure,
		leftToSpendFigure,
		leftThisWeekFigure,
		leftInLimitsFigure,
		envelopeLeftFigure,
		envelopeSpentFigure,
		moneyInFigure,
		heldForOthersFigure,
		budgetHoldsFigure,
		planCostFigure,
		typicalIncomeFigure,
		totalDebtFigure,
	];
}
