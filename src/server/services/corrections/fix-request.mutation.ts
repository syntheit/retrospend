/**
 * Ask to fix as mutations, so each previews as the same write rolled back
 * and returns what its undo needs. None of them moves money (the preview
 * lists the always-checked figures as unchanged); they have the same pair
 * shape as every other write so the sheets treat them alike.
 *
 * - fixRequest.ask: undo is fixRequest.withdraw (deletes it, while unanswered).
 * - fixRequest.respond, fixRequest.cancel: undo is fixRequest.restore.
 * - fixRequest.withdraw: undo is fixRequest.ask again.
 */
import type {
	AskToFixInput,
	CancelFixInput,
	FixRequestResult,
	RespondToFixInput,
	RestoreFixInput,
} from "~/lib/schemas/corrections";
import type { MoneyMutation } from "../preview/types";
import {
	askToFix,
	cancelFixRequest,
	respondToFix,
	restoreFixRequest,
	withdrawFixRequest,
} from "./fix-request.service";

interface Deferred {
	readonly notify?: (() => Promise<void>)[];
}

const row = (id: string) => [{ table: "fix_request", id }];

export const askToFixMutation: MoneyMutation<
	AskToFixInput & Deferred,
	FixRequestResult
> = {
	id: "fixRequest.ask",
	touches: [],
	run: async (tx, { notify, ...input }, actor) => ({
		value: await askToFix(tx, actor.userId, input, notify),
		undo: {
			kind: "revert",
			mutation: "fixRequest.withdraw",
			rows: row(input.id),
		},
	}),
};

export const respondToFixMutation: MoneyMutation<
	RespondToFixInput & Deferred,
	FixRequestResult
> = {
	id: "fixRequest.respond",
	touches: [],
	run: async (tx, { notify, ...input }, actor) => ({
		value: await respondToFix(tx, actor.userId, input, notify),
		undo: {
			kind: "revert",
			mutation: "fixRequest.restore",
			rows: row(input.id),
		},
	}),
};

export const cancelFixMutation: MoneyMutation<
	CancelFixInput,
	FixRequestResult
> = {
	id: "fixRequest.cancel",
	touches: [],
	run: async (tx, input, actor) => ({
		value: await cancelFixRequest(tx, actor.userId, input),
		undo: {
			kind: "revert",
			mutation: "fixRequest.restore",
			rows: row(input.id),
		},
	}),
};

export const withdrawFixMutation: MoneyMutation<
	CancelFixInput,
	{ id: string }
> = {
	id: "fixRequest.withdraw",
	touches: [],
	run: async (tx, input, actor) => ({
		value: await withdrawFixRequest(tx, actor.userId, input),
		undo: {
			kind: "revert",
			mutation: "fixRequest.ask",
			rows: row(input.id),
		},
	}),
};

export const restoreFixMutation: MoneyMutation<
	RestoreFixInput,
	FixRequestResult
> = {
	id: "fixRequest.restore",
	touches: [],
	run: async (tx, input, actor) => ({
		value: await restoreFixRequest(tx, actor.userId, input),
		undo: {
			kind: "revert",
			mutation: "fixRequest.respond",
			rows: row(input.id),
		},
	}),
};
