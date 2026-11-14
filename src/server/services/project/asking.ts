import type { ParticipantType } from "~prisma";

type Ref = { participantType: ParticipantType; participantId: string };

/**
 * Who is asking you to review an expense: its payer, or its creator when you
 * paid (as the People needs list reads it, people/needs.ts). Null when that
 * is you too.
 */
export function askingOf(
	e: {
		paidByType: ParticipantType;
		paidById: string;
		createdByType: ParticipantType;
		createdById: string;
	},
	isMe: (r: Ref) => boolean,
): Ref | null {
	const payer = { participantType: e.paidByType, participantId: e.paidById };
	const creator = {
		participantType: e.createdByType,
		participantId: e.createdById,
	};
	const asking = isMe(payer) ? creator : payer;
	return isMe(asking) ? null : asking;
}
