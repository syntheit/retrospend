import { type ShareRefusal, shareRefusalOf } from "./share-refusal";

/** What the review sheet previews: the answer a tap would save. Reason moves no figure, so it is no part of it. */
export function answerInput(txnId: string, rejecting: boolean) {
	return { txnId, answer: rejecting ? "reject" : "accept" } as const;
}

/** The reason as typed, or nothing when it is only whitespace (never trimmed: user text is kept as written). */
export function reasonOf(text: string): string | undefined {
	return text.trim() === "" ? undefined : text;
}

/** What a failed dry run or save says: the refusal's own sentence, or the generic one. */
export function failureSentence(
	error: unknown,
	refused: (code: ShareRefusal) => string,
	generic: string,
): string {
	const code = shareRefusalOf(error);
	return code ? refused(code) : generic;
}

/** The signed undo a save returned, or null when the share already read the answer (nothing to take back). */
export function undoTokenOf(done: {
	readonly changed: boolean;
	readonly restore: { readonly data: string; readonly sig: string } | null;
}) {
	return done.changed ? done.restore : null;
}
