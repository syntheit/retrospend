import { budgetMoneyBook } from "./money-book";
import { budgetMoneyPlan } from "./money-plan";
import { budgetPlanWrites, budgetUndo } from "./plan-writes";
import { budgetReads } from "./reads";

export { budgetUndoResultSchema } from "./plan-writes";
export * as budgetSchemas from "./schemas";

/**
 * The envelope budget over v1: reads, money writes with a preview twin and
 * an undo token, and the plan edits that move no money. Amounts that go in
 * are decimal text in the currency's major units, converted at the edge with
 * the currency's decimals checked (400 beyond them); amounts that come out
 * are `{ minor, currency }`.
 */
export const budgetContract = {
	...budgetReads,
	...budgetMoneyBook,
	...budgetMoneyPlan,
	...budgetPlanWrites,
	...budgetUndo,
};
