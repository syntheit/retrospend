/**
 * Telling the other people on a split expense that it is theirs again: the
 * undo of a delete puts it back, and they were told it was gone. The same
 * notice an add sends (transaction.service.ts), queued like it so it goes out
 * only after the undo commits.
 */
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";

interface Restored {
	id: string;
	description: string;
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
	const actorName = await resolveParticipantName("user", actorUserId);
	const total = Number(restored.amount);
	const { currency, description: desc } = restored;
	for (const sp of restored.splitParticipants) {
		if (sp.participantType !== "user" || sp.participantId === actorUserId)
			continue;
		const share = Number(sp.shareAmount);
		await createNotification({
			userId: sp.participantId,
			type: "EXPENSE_SPLIT",
			title: "New shared expense",
			body: `${actorName} split '${desc}' with you; your share: ${currency} ${share.toFixed(2)} (of ${currency} ${total.toFixed(2)})`,
			data: {
				transactionId: restored.id,
				actorType: "user",
				actorId: actorUserId,
			},
		});
	}
}
