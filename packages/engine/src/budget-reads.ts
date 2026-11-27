/**
 * What a device write may ask of the budget: whether it can be read at all,
 * and the personal book (the one the server's recordWealthMove writes a
 * move's budget side into). Read only; a pull is the only thing that changes
 * either.
 */
import { type BudgetStatus, budgetStatus } from "./budget-gate";
import type { Reader, TableRows } from "./port";

export function budgetReads(r: Reader) {
	return {
		/** "ready" only when the figures read; "none" and "stale" both mean the device cannot see the whole budget. */
		status: (): BudgetStatus => budgetStatus(r),
		/** The personal book the device holds, or none. */
		book: (): TableRows["budgetBooks"] | undefined => r.list("budgetBooks")[0],
	};
}
