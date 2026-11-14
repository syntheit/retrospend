/**
 * The web's accept and reject, with an undo (R30, R15). Each wraps the v1
 * mutation under its own id, so the events fire the same and the write is
 * the same code; the one difference is how the undo travels. The v1 routes
 * keep it in their own undo token, the web gets a signed one on a save, so
 * the client never sends what the share was (its status, time or reason).
 * A preview carries no token: a dry run has nothing to take back.
 */
import { inPreview } from "~/server/db-tx";
import {
	type RestoreToken,
	readRestore,
	signRestore,
} from "~/server/services/entry/restore-token";
import type { MoneyMutation } from "~/server/services/preview/types";
import {
	type AnswerShareInput,
	answerShareMutation,
	type RestoreAnswerInput,
	restoreAnswerMutation,
	type ShareAnswered,
} from "./answer-share.mutation";

/** The kind a web answer's undo token names, so no other token restores a share. */
export const ANSWER_RESTORE = "share.answer";

/** The answer as the web reads it: what the share now reads, and the undo. */
export type WebAnswered = Omit<ShareAnswered, "was"> & {
	/** Present on a save that changed the share; null on a preview or no change. */
	readonly restore: RestoreToken | null;
};

export const answerShareWebMutation: MoneyMutation<
	AnswerShareInput,
	WebAnswered
> = {
	...answerShareMutation,
	run: async (tx, input, actor) => {
		const done = await answerShareMutation.run(tx, input, actor);
		const { was, ...value } = done.value;
		const restore =
			value.changed && !inPreview()
				? signRestore(ANSWER_RESTORE, actor.userId, {
						transactionId: value.transactionId,
						answer: value.answer,
						was,
					} satisfies RestoreAnswerInput)
				: null;
		return { value: { ...value, restore }, undo: done.undo };
	},
};

export interface RestoreAnswerWebInput {
	readonly restore: RestoreToken;
}

export const restoreAnswerWebMutation: MoneyMutation<
	RestoreAnswerWebInput,
	{ readonly transactionId: string }
> = {
	id: restoreAnswerMutation.id,
	touches: restoreAnswerMutation.touches,
	run: async (tx, input, actor) => {
		const payload = readRestore<RestoreAnswerInput>(
			input.restore,
			ANSWER_RESTORE,
			actor.userId,
		);
		return restoreAnswerMutation.run(tx, payload, actor);
	},
};
