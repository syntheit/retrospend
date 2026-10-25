import { budgetMoneyBook } from "./money-book";
import { budgetMoneyPlan } from "./money-plan";
import { budgetPlanWrites, budgetUndo } from "./plan-writes";
import { budgetReads } from "./reads";

export { budgetUndoResultSchema } from "./plan-writes";
export * as budgetSchemas from "./schemas";

/**
 * The envelope budget over v1: reads, money writes with a preview twin and
 * an undo token, and the plan edits that move no money. Amounts that go in
 * are integer minor units of the book currency (`amountMinor`), because the
 * engine is integer-only; amounts that come out are `{ minor, currency }`.
 */
export const budgetContract = {
	...budgetReads,
	...budgetMoneyBook,
	...budgetMoneyPlan,
	...budgetPlanWrites,
	...budgetUndo,
};
