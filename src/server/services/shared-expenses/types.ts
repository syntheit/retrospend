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

/** A fixed order for rows the database returns in no particular order. */
export function compareParticipants(a: ParticipantRef, b: ParticipantRef): number {
	const x = `${a.participantType}:${a.participantId}`;
	const y = `${b.participantType}:${b.participantId}`;
	return x < y ? -1 : x > y ? 1 : 0;
}
