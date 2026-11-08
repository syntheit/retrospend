/**
 * The recurring figures (IMPLEMENTATION §2.4), read from the same
 * computation as the Recurring page (recurring.listView):
 * - `recurring.amount`: a template's amount in its own currency, narrowed
 *   by `recurringId`.
 * - `recurring.cost.<out|in>.<month|quarter|year>`: what the active
 *   templates of one direction cost (or bring in) per period, in the home
 *   currency at today's rates. A template in a currency with no rate makes
 *   the figure unavailable (R14): never a sum of the rest, zero or a rate of
 *   1. The page names the currencies and shows its partial line untagged.
 *   An "in" figure is empty when no active template brings money in.
 */
import {
	type RecurringDirection,
	type RecurringPeriod,
	recurringAmountOf,
	recurringCostOf,
} from "@retrospend/domain/recurring-view";
import { FigureNarrowingError } from "~/server/figures/narrowing";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
	FigureScope,
} from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import {
	type RecurringBody,
	readRecurringBody,
} from "~/server/services/recurring-view.service";

/** One read of the templates per pass: the six costs and the amounts share it. */
function bodyOnce(
	db: FigureDb,
	scope: FigureScope,
	pass?: FigurePass,
): Promise<RecurringBody> {
	const load = () => readRecurringBody(db, scope.userId, undefined, new Date());
	return pass ? pass.once(`recurring:${scope.userId}`, load) : load();
}

const recurringAmount: FigureDefinition = {
	id: "recurring.amount",
	scope: ["recurringId"],
	compute: async (db, scope, pass) => {
		if (!scope.recurringId)
			throw new FigureNarrowingError(
				"recurring.amount needs a recurringId narrowing",
			);
		return recurringAmountOf(
			await bodyOnce(db, scope, pass),
			scope.recurringId,
		);
	},
};

const DIRECTIONS: readonly RecurringDirection[] = ["out", "in"];
const PERIODS: readonly RecurringPeriod[] = ["month", "quarter", "year"];

const costFigures = DIRECTIONS.flatMap((dir) =>
	PERIODS.map(
		(period): FigureDefinition => ({
			id: `recurring.cost.${dir}.${period}`,
			scope: [],
			compute: async (db, scope, pass) => {
				const cost = recurringCostOf(
					await bodyOnce(db, scope, pass),
					dir,
					period,
				);
				return Array.isArray(cost)
					? cost
					: new FigureUnavailable(cost.unavailable);
			},
		}),
	),
);

export const recurringFigures: readonly FigureDefinition[] = [
	recurringAmount,
	...costFigures,
];

/** The six cost figures, for the mutations that add, remove or restore a template. */
export const RECURRING_COST_FIGURES: readonly string[] = DIRECTIONS.flatMap(
	(dir) => PERIODS.map((period) => `recurring.cost.${dir}.${period}`),
);
