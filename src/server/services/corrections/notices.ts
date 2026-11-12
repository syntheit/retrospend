/**
 * The notifications corrections and Ask to fix send. The text is made in
 * notification-text.ts from the kind and the sender's name, never from a
 * title or a message (end-to-end encryption rule 3), in the reader's
 * language. The kind also rides in `data`.
 *
 * Existing notification types are reused (no new type to add to every
 * client's settings): asking someone to fix is a VERIFICATION_REQUEST, the
 * rest are EXPENSE_EDITED. They are queued in the write and sent after it
 * commits, so a preview tells nobody.
 */
import type { NoticeKind } from "~/server/services/notification-text";
import { createNotification } from "~/server/services/notifications";

export type CorrectionNoticeKind =
	| "FIX_REQUESTED"
	| "FIX_ACCEPTED"
	| "FIX_DECLINED"
	| "SPLIT_CORRECTED";

const NOTICE: Record<
	CorrectionNoticeKind,
	{
		type: "VERIFICATION_REQUEST" | "EXPENSE_EDITED";
		kind: NoticeKind;
	}
> = {
	FIX_REQUESTED: { type: "VERIFICATION_REQUEST", kind: "fixRequested" },
	FIX_ACCEPTED: { type: "EXPENSE_EDITED", kind: "fixAccepted" },
	FIX_DECLINED: { type: "EXPENSE_EDITED", kind: "fixDeclined" },
	SPLIT_CORRECTED: { type: "EXPENSE_EDITED", kind: "splitCorrected" },
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
		const { type, kind } = NOTICE[notice.kind];
		await createNotification({
			userId: notice.to,
			type,
			notice: { kind, actor: { type: "user", id: notice.from } },
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
