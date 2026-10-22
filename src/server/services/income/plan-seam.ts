/**
 * Use my plan (owner N72, INCOME.md): confirming money in assigns it by the
 * plan in the same action. The plan engine is track 2B P2's
 * `plan.preview/apply` (src/server/services/envelope/*), which is not on
 * this branch, so there is no plan to apply yet and this writes nothing.
 * Callers pass what the plan needs (the income row and its booked value) and
 * show the result, so 2B swaps the body for `plan.apply` inside the same
 * transaction when P2 lands (docs/ui/GAPS.md, "Use my plan on confirm").
 */
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";

export interface PlanRequest {
	readonly userId: string;
	readonly incomeExpenseId: string;
	/** The income's booked value: what the plan may assign. */
	readonly amount: Money | null;
}

export interface PlanResult {
	readonly applied: boolean;
	readonly reason: "no_envelope_budget" | "not_requested" | null;
}

export async function applyPlanFor(
	_tx: Prisma.TransactionClient,
	_request: PlanRequest,
): Promise<PlanResult> {
	return { applied: false, reason: "no_envelope_budget" };
}
