/**
 * The notifications corrections and Ask to fix send, built in one place
 * from ids, kinds and the sender's name, never from a title or a message
 * (end-to-end encryption rule 3). The kind rides in `data`, so a client can
 * word it in the reader's language; the text here is the English fallback.
 *
 * Existing notification types are reused (no new type to add to every
 * client's settings): asking someone to fix is a VERIFICATION_REQUEST, the
 * rest are EXPENSE_EDITED. They are queued in the write and sent after it
 * commits, so a preview tells nobody.
 */
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";

export type CorrectionNoticeKind =
	| "FIX_REQUESTED"
	| "FIX_ACCEPTED"
	| "FIX_DECLINED"
	| "SPLIT_CORRECTED";

const TEXT: Record<
	CorrectionNoticeKind,
	{
		type: "VERIFICATION_REQUEST" | "EXPENSE_EDITED";
		title: string;
		body: string;
	}
> = {
	FIX_REQUESTED: {
		type: "VERIFICATION_REQUEST",
		title: "Fix requested",
		body: "{name} asked you to fix an expense",
	},
	FIX_ACCEPTED: {
		type: "EXPENSE_EDITED",
		title: "Fix accepted",
		body: "{name} will fix the expense you asked about",
	},
	FIX_DECLINED: {
		type: "EXPENSE_EDITED",
		title: "Fix declined",
		body: "{name} will not change the expense you asked about",
	},
	SPLIT_CORRECTED: {
		type: "EXPENSE_EDITED",
		title: "Expense corrected",
		body: "{name} added a correction to an expense you share",
	},
};

export interface CorrectionNotice {
	readonly kind: CorrectionNoticeKind;
	/** The user told. */
	readonly to: string;
	/** The user who did it. */
	readonly from: string;
	readonly transactionId: string;
	readonly fixRequestId?: string;
	readonly correctionIds?: readonly string[];
}

/** The send, queued by the write and run after it commits. */
export function noticeSender(notice: CorrectionNotice): () => Promise<void> {
	return async () => {
		const text = TEXT[notice.kind];
		const name = await resolveParticipantName("user", notice.from);
		await createNotification({
			userId: notice.to,
			type: text.type,
			title: text.title,
			body: text.body.replace("{name}", name),
			data: {
				kind: notice.kind,
				transactionId: notice.transactionId,
				...(notice.fixRequestId ? { fixRequestId: notice.fixRequestId } : {}),
				...(notice.correctionIds
					? { correctionIds: [...notice.correctionIds] }
					: {}),
				fromParticipantType: "user",
				fromParticipantId: notice.from,
			},
		});
	};
}
