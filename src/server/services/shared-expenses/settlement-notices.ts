/**
 * Telling the other person on a payment group what happened to it: they
 * confirmed it, rejected it, or sent a reminder. The text comes from the kind,
 * the sender's name and the group's amount only (notification-text.ts); a
 * rejection reason or a note the person typed stays on the settlement row.
 * Split from settlement.service.ts.
 */
import type { NoticeKind } from "~/server/services/notification-text";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import type { NotificationType } from "~prisma";
import {
	type GroupRow,
	groupCounterparty,
	groupNoticeAmount,
} from "./settlement-groups";

export async function tellGroupCounterparty(
	rows: GroupRow[],
	senderId: string,
	notice: {
		type: NotificationType;
		kind: NoticeKind;
		/** Who the notification leads to, and which settlement it is about. */
		data: Record<string, unknown>;
	},
): Promise<void> {
	const other = groupCounterparty(rows, senderId);
	if (other?.participantType !== "user") return;
	const actor = await resolveParticipantName("user", senderId);
	createNotification({
		userId: other.participantId,
		type: notice.type,
		notice: {
			kind: notice.kind,
			actor,
			amount: groupNoticeAmount(rows, other.participantId),
		},
		data: notice.data,
	}).catch((err) =>
		console.error(`[Notification Error] ${notice.type}:`, err),
	);
}
