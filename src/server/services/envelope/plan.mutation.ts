/**
 * Planning writes as money mutations (R30, R15): each previews as the same
 * write rolled back and returns its undo.
 *
 * - envelope.applyRuleToMonth: "Also apply to this month's money in".
 * - envelope.applyDraft: a plan is saved (moves nothing: the preview lists
 *   every pool figure unchanged); a What if writes its moves.
 * - envelope.unapplyDraft: the plan's Apply taken back.
 * - envelope.fundPlanNow: "Fund it now from what I have".
 */
import type { MovementResult } from "~/lib/schemas/envelope";
import type {
	ApplyDraftInput,
	ApplyRuleResult,
	ApplyRuleToMonthInput,
	DraftResult,
	FundNowInput,
} from "~/lib/schemas/envelope-plan";
import type { MoneyMutation, UndoToken } from "../preview/types";
import { applyDraft, fundNow, unapplyDraft } from "./draft.service";
import { FIGURE_BUDGET_HOLDS } from "./figures";
import { applyRuleToMonth } from "./rule-crud.service";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

const POOL = [
	FIGURE_NOT_PLANNED_YET,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_BUDGET_HOLDS,
];

/** A written batch undoes as one through envelope.undo. */
function batchUndo(m: MovementResult | null): UndoToken {
	return {
		kind: "revert",
		mutation: "envelope.undo",
		rows: (m?.movements ?? []).map((x) => ({ table: "budget_movement", id: x.id })),
	};
}

export const applyRuleToMonthMutation: MoneyMutation<
	ApplyRuleToMonthInput,
	ApplyRuleResult
> = {
	id: "envelope.applyRuleToMonth",
	touches: [...POOL, "envelope.left"],
	run: async (tx, input, actor) => {
		const value = await applyRuleToMonth(tx, actor.userId, input, new Date());
		return { value, undo: batchUndo(value.movement) };
	},
};

export const applyDraftMutation: MoneyMutation<ApplyDraftInput, DraftResult> = {
	id: "envelope.applyDraft",
	touches: [...POOL, "envelope.left"],
	run: async (tx, input, actor) => {
		const value = await applyDraft(tx, actor.userId, input, new Date());
		const undo: UndoToken =
			value.draft.kind === "PLAN"
				? {
						kind: "revert",
						mutation: "envelope.unapplyDraft",
						rows: [{ table: "budget_draft", id: value.draft.id }],
					}
				: batchUndo(value.movement);
		return { value, undo };
	},
};

export const unapplyDraftMutation: MoneyMutation<
	{ draftId: string },
	DraftResult
> = {
	id: "envelope.unapplyDraft",
	touches: [...POOL],
	run: async (tx, input, actor) => {
		const value = await unapplyDraft(tx, actor.userId, input.draftId, new Date());
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.applyDraft",
				rows: [{ table: "budget_draft", id: value.draft.id }],
			},
		};
	},
};

export const fundPlanNowMutation: MoneyMutation<FundNowInput, DraftResult> = {
	id: "envelope.fundPlanNow",
	touches: [...POOL, "envelope.left"],
	run: async (tx, input, actor) => {
		const value = await fundNow(tx, actor.userId, input, new Date());
		return { value, undo: batchUndo(value.movement) };
	},
};
