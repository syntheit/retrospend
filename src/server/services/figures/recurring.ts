/**
 * The recurring figures (IMPLEMENTATION §2.4), read from the same
 * computation as the Recurring page (recurring.listView):
 * - `recurring.amount`: a template's amount in its own currency, narrowed
 *   by `recurringId`.
 * - `recurring.cost.<out|in>.<month|quarter|year>`: what the active
 *   templates of one direction cost (or bring in) per period, in the home
 *   currency at today's rates. A template in a currency with no rate stays
 *   out of the total, as it does on the page, where it is named (R14); an
 *   "in" figure is empty when no active template brings money in.
 */
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
	FigureScope,
} from "~/server/figures/registry";
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
			throw new Error("recurring.amount needs a recurringId narrowing");
		const body = await bodyOnce(db, scope, pass);
		const item = body.items.find((i) => i.id === scope.recurringId);
		return item ? [item.amount] : [];
	},
};

const DIRECTIONS = ["out", "in"] as const;
const PERIODS = ["month", "quarter", "year"] as const;

const costFigures = DIRECTIONS.flatMap((dir) =>
	PERIODS.map(
		(period): FigureDefinition => ({
			id: `recurring.cost.${dir}.${period}`,
			scope: [],
			compute: async (db, scope, pass) => {
				const cost = (await bodyOnce(db, scope, pass))[dir];
				return cost ? [cost[period]] : [];
			},
		}),
	),
);

export const recurringFigures: readonly FigureDefinition[] = [
	recurringAmount,
	...costFigures,
];
