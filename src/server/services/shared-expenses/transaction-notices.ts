/**
 * Telling the other people on a split expense that it was added, edited or
 * deleted. The text is made in notification-text.ts from the kind, the
 * actor's name and amounts only, never the expense's title or notes.
 * Split from transaction.service.ts.
 */
import {
	type NoticeChanges,
	noticeMoney,
} from "~/server/services/notification-text";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import type { ParticipantRef } from "./types";

export async function notifyExpenseSplit(
	actor: ParticipantRef,
	transaction: {
		id: string;
		amount: unknown;
		currency: string;
		createdByType: string;
		createdById: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
			shareAmount: unknown;
		}>;
	},
) {
	const actorName = await resolveParticipantName(
		actor.participantType,
		actor.participantId,
	);
	const currency = transaction.currency;
	const total = noticeMoney(transaction.amount, currency);

	for (const sp of transaction.splitParticipants) {
		if (sp.participantType !== "user") continue;
		// Don't notify the creator
		if (
			sp.participantType === actor.participantType &&
			sp.participantId === actor.participantId
		)
			continue;

		const share = noticeMoney(sp.shareAmount, currency);
		await createNotification({
			userId: sp.participantId,
			type: "EXPENSE_SPLIT",
			notice: {
				kind: "expenseSplit",
				actor: actorName,
				amount: share && { money: share },
				total,
			},
			data: {
				transactionId: transaction.id,
				actorType: actor.participantType,
				actorId: actor.participantId,
			},
		});
	}
}

export async function notifyExpenseEdited(
	actor: ParticipantRef,
	updated: {
		id: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
		}>;
	},
	changes: NoticeChanges,
) {
	const actorName = await resolveParticipantName(
		actor.participantType,
		actor.participantId,
	);

	for (const sp of updated.splitParticipants) {
		if (sp.participantType !== "user") continue;
		if (
			sp.participantType === actor.participantType &&
			sp.participantId === actor.participantId
		)
			continue;

		await createNotification({
			userId: sp.participantId,
			type: "EXPENSE_EDITED",
			notice: { kind: "expenseEdited", actor: actorName, changes },
			data: {
				transactionId: updated.id,
				actorType: actor.participantType,
				actorId: actor.participantId,
			},
		});
	}
}

export async function notifyExpenseDeleted(
	actor: ParticipantRef,
	existing: {
		id: string;
		amount: unknown;
		currency: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
		}>;
	},
) {
	const actorName = await resolveParticipantName(
		actor.participantType,
		actor.participantId,
	);
	const amount = noticeMoney(existing.amount, existing.currency);

	for (const sp of existing.splitParticipants) {
		if (sp.participantType !== "user") continue;
		if (
			sp.participantType === actor.participantType &&
			sp.participantId === actor.participantId
		)
			continue;

		await createNotification({
			userId: sp.participantId,
			type: "EXPENSE_DELETED",
			notice: {
				kind: "expenseDeleted",
				actor: actorName,
				amount: amount && { money: amount },
			},
			data: {
				transactionId: existing.id,
				actorType: actor.participantType,
				actorId: actor.participantId,
			},
		});
	}
}
