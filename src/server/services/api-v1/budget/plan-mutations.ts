import type {
	DebtTermsResult,
	PayoffPlanResult,
	SavePayoffPlanInput,
	SetDebtTermsInput,
} from "~/lib/schemas/envelope-debt";
import type {
	GroupTargetResult,
	SetGroupTargetInput,
} from "~/lib/schemas/envelope-plan";
import {
	revertPayoffPlan,
	savePayoffPlan,
	setDebtTerms,
} from "~/server/services/envelope/debt.service";
import { FIGURE_TOTAL_DEBT } from "~/server/services/envelope/figures";
import { setGroupTarget } from "~/server/services/envelope/group.service";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "~/server/services/envelope/verdict";
import type { MoneyMutation } from "~/server/services/preview/types";

/**
 * Group targets, debt terms and the payoff plan as money mutations. They move
 * no money themselves, but they change what each month's plan asks (and the
 * payoff plan sets an envelope's target), so v1 previews them and ends them
 * with an undo, like Set a target. The services are the web's own; they take
 * the transaction, so a preview is a dry run of the same write.
 */

const POOL = [
	FIGURE_NOT_PLANNED_YET,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_LEFT_IN_LIMITS,
	"envelope.left",
];

const noToken = { kind: "revert", mutation: "none", rows: [] } as const;

export const setGroupTargetMutation: MoneyMutation<
	SetGroupTargetInput,
	GroupTargetResult
> = {
	id: "envelope.setGroupTarget",
	touches: POOL,
	run: async (tx, input, actor) => ({
		value: await setGroupTarget(tx, actor.userId, input),
		undo: noToken,
	}),
};

export const setDebtTermsMutation: MoneyMutation<
	SetDebtTermsInput,
	DebtTermsResult
> = {
	id: "envelope.setDebtTerms",
	touches: [...POOL, FIGURE_TOTAL_DEBT],
	scope: (input) => ({ accountId: input.assetAccountId }),
	run: async (tx, input) => ({
		value: await setDebtTerms(tx, input),
		undo: noToken,
	}),
};

export const savePayoffPlanMutation: MoneyMutation<
	SavePayoffPlanInput,
	PayoffPlanResult
> = {
	id: "envelope.savePayoffPlan",
	touches: POOL,
	run: async (tx, input, actor) => ({
		value: await savePayoffPlan(tx, actor.userId, input),
		undo: noToken,
	}),
};

export const revertPayoffPlanMutation: MoneyMutation<
	Record<string, never>,
	PayoffPlanResult
> = {
	id: "envelope.revertPayoffPlan",
	touches: POOL,
	run: async (tx, _input, actor) => ({
		value: await revertPayoffPlan(tx, actor.userId),
		undo: noToken,
	}),
};
