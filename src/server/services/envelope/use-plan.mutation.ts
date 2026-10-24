/**
 * Use my plan as a money mutation (R30, R15): the plan Add income ends with
 * (applyPlan, one batch across this month and, for Next month, the next),
 * run on what is Not planned yet. The preview is the same write rolled back.
 * The undo is envelope.undo on the batch.
 */
import type {
	UsePlanInput,
	UsePlanResult,
} from "~/lib/schemas/envelope-use-plan";
import type { MoneyMutation } from "../preview/types";
import { EnvelopeError } from "./errors";
import { monthViewIn } from "./month-read";
import { applyPlan } from "./use-my-plan";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

export const usePlanMutation: MoneyMutation<UsePlanInput, UsePlanResult> = {
	id: "envelope.usePlan",
	touches: [
		FIGURE_NOT_PLANNED_YET,
		FIGURE_LEFT_TO_SPEND,
		FIGURE_LEFT_IN_LIMITS,
		"envelope.left",
	],
	run: async (tx, input, actor) => {
		const now = new Date();
		const read = await monthViewIn(tx, actor.userId, now);
		if (!read) throw new EnvelopeError("NO_BOOK", "start a budget first");
		const amount =
			input.amountMinor ?? Math.max(0, read.dto.toAssign.amount.minor);
		if (amount <= 0)
			throw new EnvelopeError("INVALID", "there is nothing to plan");
		const plan = await applyPlan(tx, actor.userId, now, {
			amount,
			rest: input.rest,
		});
		if (!plan) throw new EnvelopeError("NO_BOOK", "start a budget first");
		const rows = plan.batchId
			? await tx.budgetMovement.findMany({
					where: { batchId: plan.batchId },
					select: { id: true },
				})
			: [];
		return {
			value: {
				batchId: plan.batchId,
				lines: plan.lines,
				rest: plan.rest,
				restChoice: plan.restChoice,
			},
			undo: {
				kind: "revert",
				mutation: "envelope.undo",
				rows: rows.map((r) => ({ table: "budget_movement", id: r.id })),
			},
		};
	},
};
