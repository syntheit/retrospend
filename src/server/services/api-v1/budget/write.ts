import { createMoneyOp, type UndoPlan } from "../money-op";
import type { BudgetCaller } from "./serve";

/** The inverse calls a budget undo token can name (the `kind` of the undo answer). */
export type UndoOp =
	| "movement.undo"
	| "change.undo"
	| "limit.revert"
	| "style.revert"
	| "adjustment.remove"
	| "share_category.set"
	| "project_routing.set"
	| "forgive.undo"
	| "period.set"
	| "draft.unapply"
	| "hidden_rows.revert"
	| "debt_payment.delete";

export type BudgetUndoPlan = UndoPlan<UndoOp>;

/**
 * A budget money write as the pair every v1 route needs: `write` applies the
 * web's own mutation and mints the undo token; `preview` runs the same
 * mutation rolled back (money-op.ts).
 */
export const moneyOp = createMoneyOp<UndoOp, BudgetCaller>("budget");
export type { MoneyOp } from "../money-op";
