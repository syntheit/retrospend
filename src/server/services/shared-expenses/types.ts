import type { ParticipantType } from "~prisma";

export interface ParticipantRef {
	participantType: ParticipantType;
	participantId: string;
}

export function sameParticipant(a: ParticipantRef, b: ParticipantRef): boolean {
	return (
		a.participantType === b.participantType &&
		a.participantId === b.participantId
	);
}
