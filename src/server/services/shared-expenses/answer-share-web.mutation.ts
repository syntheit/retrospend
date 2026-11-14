/**
 * The web's accept and reject, with an undo (R30, R15). Each wraps the v1
 * mutation under its own id, so the events fire the same and the write is
 * the same code; the one difference is how the undo travels. The v1 routes
 * keep it in their own undo token, the web gets a signed one on a save, so
 * the client never sends what the share was (its status, time or reason).
 * A preview carries no token: a dry run has nothing to take back. The token
 * also names when the answer was written (`answeredAt`), and an undo refuses
 * once the share carries another answer time, so a token from before a later
 * answer never puts an older state back.
 */
import { TRPCError } from "@trpc/server";
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

/** What a web undo token signs: the v1 restore input and when the answer landed. */
interface AnswerRestore extends RestoreAnswerInput {
	readonly answeredAt: string;
}

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
		let restore: RestoreToken | null = null;
		if (value.changed && !inPreview()) {
			const now = await tx.splitParticipant.findUniqueOrThrow({
				where: { id: was.splitId },
				select: { verifiedAt: true },
			});
			restore = signRestore(ANSWER_RESTORE, actor.userId, {
				transactionId: value.transactionId,
				answer: value.answer,
				was,
				answeredAt: now.verifiedAt?.toISOString() ?? "",
			} satisfies AnswerRestore);
		}
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
		const { answeredAt, ...payload } = readRestore<AnswerRestore>(
			input.restore,
			ANSWER_RESTORE,
			actor.userId,
		);
		const share = await tx.splitParticipant.findUnique({
			where: { id: payload.was.splitId },
			select: { verifiedAt: true },
		});
		if (share && (share.verifiedAt?.toISOString() ?? "") !== answeredAt)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Your share changed since. Undo is no longer safe.",
			});
		return restoreAnswerMutation.run(tx, payload, actor);
	},
};
