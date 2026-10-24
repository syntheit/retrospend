/**
 * Corrections as money mutations (R30, R15): the Correct sheet previews the
 * same write it saves, rolled back.
 *
 * - correction.apply: undo is correction.undo of the rows it wrote, which also
 *   puts the fix requests it answered back.
 * - correction.undo: undo is correction.apply with the same input again.
 */
import type {
	CorrectInput,
	CorrectResult,
	UndoCorrectionInput,
} from "~/lib/schemas/corrections";
import type { MoneyMutation, UndoToken } from "../preview/types";
import {
	type CorrectContext,
	correctSplit,
	undoCorrection,
} from "./correct.service";

/** A correction moves what people owe, your spending and what the budget holds for others. */
export const CORRECTION_FIGURES = [
	"owed.owedToYou",
	"owed.youOwe",
	"spent",
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.heldForOthers",
];

export type CorrectMutationInput = CorrectInput & CorrectContext;

const rowsOf = (result: CorrectResult) => [
	...result.transactionIds.map((id) => ({ table: "shared_transaction", id })),
	...result.resolvedRequests.map((r) => ({ table: "fix_request", id: r.id })),
];

export const correctSplitMutation: MoneyMutation<
	CorrectMutationInput,
	CorrectResult
> = {
	id: "correction.apply",
	touches: CORRECTION_FIGURES,
	run: async (tx, { timeZone, notify, ...input }, actor) => {
		const value = await correctSplit(tx, actor.userId, input, {
			timeZone,
			notify,
		});
		const undo: UndoToken = {
			kind: "revert",
			mutation: "correction.undo",
			rows: rowsOf(value),
		};
		return { value, undo };
	},
};

export const undoCorrectionMutation: MoneyMutation<
	UndoCorrectionInput,
	{ transactionIds: string[] }
> = {
	id: "correction.undo",
	touches: CORRECTION_FIGURES,
	run: async (tx, input, actor) => ({
		value: await undoCorrection(tx, actor.userId, input),
		undo: {
			kind: "revert",
			mutation: "correction.apply",
			rows: input.transactionIds.map((id) => ({
				table: "shared_transaction",
				id,
			})),
		},
	}),
};
