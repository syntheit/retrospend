/**
 * Telling the other person on a payment group what happened to it: they
 * confirmed it, rejected it, or sent a reminder. The text comes from the kind,
 * the sender's name and the group's amount only (notification-text.ts); a
 * rejection reason or a note the person typed stays on the settlement row.
 * Split from settlement.service.ts.
 */
import type { Money } from "@retrospend/domain/money-minor";
import type {
	NoticeData,
	NoticeKind,
} from "~/server/services/notification-text";
import {
	type CreateNotificationParams,
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import type { NotificationType } from "~prisma";
import {
	type GroupRow,
	groupCounterparty,
	groupNoticeAmount,
} from "./settlement-groups";
import type { ParticipantRef } from "./types";

export interface SettlementSides {
	payer: ParticipantRef;
	payee: ParticipantRef;
	/** The current user is the payee and is recording a payment received. */
	recordedByPayee: boolean;
}

/**
 * Tells the registered counterparty about a new settlement: the payee that a
 * payment was sent (to confirm), or the payer that the payee recorded
 * receiving their payment. `currencies` above one reads "across N currencies".
 */
export async function tellSettlementRecorded(
	userId: string,
	sides: SettlementSides,
	paid: Money | null,
	ids: NoticeData,
	currencies = 1,
): Promise<void> {
	const actor = await resolveParticipantName("user", userId);
	const amount = paid && { money: paid, currencies };
	const notification: CreateNotificationParams = sides.recordedByPayee
		? {
				userId: sides.payer.participantId,
				type: "SETTLEMENT_CONFIRMED",
				notice: { kind: "paymentRecordedByPayee", actor, amount },
				data: { ...ids, toParticipantType: "user", toParticipantId: userId },
			}
		: {
				userId: sides.payee.participantId,
				type: "SETTLEMENT_RECEIVED",
				notice: { kind: "settlementReceived", actor, amount },
				data: {
					...ids,
					fromParticipantType: "user",
					fromParticipantId: userId,
				},
			};
	createNotification(notification).catch((err) =>
		console.error(`[Notification Error] ${notification.type}:`, err),
	);
}

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
	}).catch((err) => console.error(`[Notification Error] ${notice.type}:`, err));
}
