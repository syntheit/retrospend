/**
 * Answering the hidden-rows review as money mutations (R30, R15): Spending
 * counts a row in every total, Not spending takes it out of them all, so the
 * budget's figures move and each answer previews as the same write rolled
 * back and ends with an undo.
 */
import type {
	ResolveHiddenInput,
	ResolveHiddenResult,
	RevertHiddenInput,
} from "~/lib/schemas/envelope-migration";
import type { MoneyMutation } from "../preview/types";
import { resolveHidden, revertHidden } from "./hidden-rows";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

const TOUCHES = [
	FIGURE_NOT_PLANNED_YET,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_LEFT_IN_LIMITS,
];

const rowRefs = (v: ResolveHiddenResult) =>
	[...v.spending, ...v.notSpending].map((id) => ({ table: "expense", id }));

export const resolveHiddenMutation: MoneyMutation<
	ResolveHiddenInput,
	ResolveHiddenResult
> = {
	id: "envelope.resolveHidden",
	touches: TOUCHES,
	run: async (tx, input, actor) => {
		const value = await resolveHidden(tx, actor.userId, input.answers);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.revertHidden",
				rows: rowRefs(value),
			},
		};
	},
};

export const revertHiddenMutation: MoneyMutation<
	RevertHiddenInput,
	ResolveHiddenResult
> = {
	id: "envelope.revertHidden",
	touches: TOUCHES,
	run: async (tx, input, actor) => {
		const value = await revertHidden(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "envelope.resolveHidden",
				rows: rowRefs(value),
			},
		};
	},
};
