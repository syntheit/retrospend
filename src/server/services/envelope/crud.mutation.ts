/**
 * Envelope edits as money mutations (R30, R15): each previews as the same
 * write rolled back and returns its undo, which is `envelope.undoChange` on
 * the edit's id (what it changed is stored server side). Setting a target
 * moves no money but changes what the plan asks of each month, so it
 * previews too; the rest reroute spending or move money between envelopes.
 */
import type {
	ArchiveEnvelopeInput,
	ArchiveEnvelopeResult,
	ConfirmStartingMoneyInput,
	ConfirmStartingMoneyResult,
	CreateEnvelopeInput,
	CreateEnvelopeResult,
	MergeEnvelopesInput,
	MergeEnvelopesResult,
	SetTargetInput,
	SetTargetResult,
	UndoChangeInput,
	UndoChangeResult,
	UpdateEnvelopeInput,
	UpdateEnvelopeResult,
} from "~/lib/schemas/envelope-crud";
import type { MoneyMutation, UndoToken } from "../preview/types";
import { undoChange } from "./change-undo.service";
import { archiveEnvelope, mergeEnvelopes } from "./combine.service";
import { createEnvelope, updateEnvelope } from "./crud.service";
import { FIGURE_BUDGET_HOLDS } from "./figures";
import { confirmStartingMoney } from "./starting-money.service";
import { setTarget } from "./target.service";
import {
	FIGURE_LEFT_IN_LIMITS,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "./verdict";

const POOL = [
	FIGURE_NOT_PLANNED_YET,
	FIGURE_LEFT_TO_SPEND,
	FIGURE_LEFT_IN_LIMITS,
];
// What the budget holds never changes in an edit; the preview says so.
const TOUCHES = [...POOL, "envelope.left", FIGURE_BUDGET_HOLDS];

/** The undo of every envelope edit: `envelope.undoChange` on the edit's id. */
const undoOf = (changeId: string): UndoToken => ({
	kind: "revert",
	mutation: "envelope.undoChange",
	rows: [{ table: "envelope_change", id: changeId }],
});

export const setTargetMutation: MoneyMutation<SetTargetInput, SetTargetResult> =
	{
		id: "envelope.setTarget",
		touches: TOUCHES,
		scope: (input) => ({ envelopeId: input.envelopeId }),
		run: async (tx, input, actor) => {
			const value = await setTarget(tx, actor.userId, input, new Date());
			return { value, undo: undoOf(value.changeId) };
		},
	};

export const createEnvelopeMutation: MoneyMutation<
	CreateEnvelopeInput,
	CreateEnvelopeResult
> = {
	id: "envelope.createEnvelope",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.id }),
	run: async (tx, input, actor) => {
		const value = await createEnvelope(tx, actor.userId, input, new Date());
		return { value, undo: undoOf(value.changeId) };
	},
};

export const updateEnvelopeMutation: MoneyMutation<
	UpdateEnvelopeInput,
	UpdateEnvelopeResult
> = {
	id: "envelope.updateEnvelope",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.envelopeId }),
	run: async (tx, input, actor) => {
		const value = await updateEnvelope(tx, actor.userId, input, new Date());
		return { value, undo: undoOf(value.changeId) };
	},
};

export const mergeEnvelopesMutation: MoneyMutation<
	MergeEnvelopesInput,
	MergeEnvelopesResult
> = {
	id: "envelope.mergeEnvelopes",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.intoId }),
	run: async (tx, input, actor) => {
		const value = await mergeEnvelopes(tx, actor.userId, input, new Date());
		return { value, undo: undoOf(value.changeId) };
	},
};

export const archiveEnvelopeMutation: MoneyMutation<
	ArchiveEnvelopeInput,
	ArchiveEnvelopeResult
> = {
	id: "envelope.archiveEnvelope",
	touches: TOUCHES,
	scope: (input) => ({ envelopeId: input.envelopeId }),
	run: async (tx, input, actor) => {
		const value = await archiveEnvelope(tx, actor.userId, input, new Date());
		return { value, undo: undoOf(value.changeId) };
	},
};

export const confirmStartingMoneyMutation: MoneyMutation<
	ConfirmStartingMoneyInput,
	ConfirmStartingMoneyResult
> = {
	id: "envelope.confirmStartingMoney",
	touches: [...POOL, FIGURE_BUDGET_HOLDS],
	run: async (tx, input, actor) => {
		const value = await confirmStartingMoney(
			tx,
			actor.userId,
			input,
			new Date(),
		);
		return { value, undo: undoOf(value.changeId) };
	},
};

export const undoChangeMutation: MoneyMutation<
	UndoChangeInput,
	UndoChangeResult
> = {
	id: "envelope.undoChange",
	touches: TOUCHES,
	run: async (tx, input, actor) => {
		const value = await undoChange(tx, actor.userId, input, new Date());
		// An undo is not undone: the edit can be made again.
		return {
			value,
			undo: { kind: "revert", mutation: "envelope.undoChange", rows: [] },
		};
	},
};
