/**
 * Budget figures (IMPLEMENTATION §2.4): the envelope numbers the product
 * names, each with one definition, read for the current budget month. The
 * definitions are in @retrospend/domain/envelope/figures, shared with devices
 * (see there for what each figure is); here: the server's reads, from
 * Postgres through the pass's transaction.
 */
import {
	type BudgetReads,
	createBudgetFigures,
} from "@retrospend/domain/envelope/figures";
import type { FigureDb } from "~/server/figures/registry";
import { projectIn } from "./debt.service";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { planCostIn } from "./plan-read";

export {
	type BudgetReads,
	createBudgetFigures,
	FIGURE_BUDGET_HOLDS,
	FIGURE_HELD_FOR_OTHERS,
	FIGURE_PLAN_COST,
	FIGURE_TOTAL_DEBT,
	FIGURE_TYPICAL_INCOME,
} from "@retrospend/domain/envelope/figures";

/**
 * The server's reads. The current month is read once per figure pass. Each
 * pass reads anew: a preview's after side must see the write it wraps, and
 * writers outside the envelope services (a shared expense, a payment) do not
 * clear the transaction's month view memo.
 */
export const prismaBudgetReads: BudgetReads<FigureDb> = {
	async month(db, userId, pass) {
		const read = () => {
			forgetMonthViews(db);
			return monthViewIn(db, userId, new Date());
		};
		const view = await (pass
			? pass.once(`budget.month:${userId}`, read)
			: read());
		return view && !view.dto.incomplete ? view : null;
	},

	/** This month's plan cost read once per pass. */
	async plan(db, userId, pass) {
		const read = async () => {
			if (!(await monthViewIn(db, userId, new Date()))) return null;
			return planCostIn(db, userId, {}, new Date());
		};
		const v = await (pass ? pass.once(`budget.plan:${userId}`, read) : read());
		return v && !v.incomplete ? v : null;
	},

	async debt(db, userId, pass) {
		const read = async () => {
			if (!(await monthViewIn(db, userId, new Date()))) return null;
			return projectIn(db, userId, {}, new Date());
		};
		const v = await (pass ? pass.once(`budget.debt:${userId}`, read) : read());
		return v && !v.incomplete ? v : null;
	},
};

export const budgetFigures = createBudgetFigures(prismaBudgetReads);
