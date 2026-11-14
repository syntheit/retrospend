import { addMonths } from "./calendar";
import { computeBook, type EngineInput, sumLeft } from "./engine";
import type { Minor } from "./types";

/** To assign + Σ Left + Assigned(next month): everything the budget holds today (reconcile, SPEC §5.11). */
export function budgetHoldsOf(input: EngineInput): Minor {
	const state = computeBook(input);
	const c = state.currentMonth;
	return (
		state.toAssign(c).total +
		sumLeft(state, c) +
		state.month(addMonths(c, 1)).totals.assigned
	);
}
