/**
 * Telling the other people on a split expense that it is theirs again: the
 * undo of a delete puts it back, and they were told it was gone. The same
 * notice an add sends (transaction.service.ts), queued like it so it goes out
 * only after the undo commits.
 */
import { noticeMoney } from "~/server/services/notification-text";
import { createNotification } from "~/server/services/notifications";

interface Restored {
	id: string;
	amount: unknown;
	currency: string;
	splitParticipants: {
		participantType: string;
		participantId: string;
		shareAmount: unknown;
	}[];
}

export async function noticeRestored(
	restored: Restored,
	actorUserId: string,
): Promise<void> {
	const { currency } = restored;
	const total = noticeMoney(restored.amount, currency);
	for (const sp of restored.splitParticipants) {
		if (sp.participantType !== "user" || sp.participantId === actorUserId)
			continue;
		const share = noticeMoney(sp.shareAmount, currency);
		await createNotification({
			userId: sp.participantId,
			type: "EXPENSE_SPLIT",
			notice: {
				kind: "expenseSplit",
				actor: { type: "user", id: actorUserId },
				amount: share && { money: share },
				total,
			},
			data: {
				transactionId: restored.id,
				actorType: "user",
				actorId: actorUserId,
			},
		});
	}
}
