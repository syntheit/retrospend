/** The part of a project member that says who they are. */
export interface MemberLike {
	participantType: string;
	participantId: string;
	/** Left the project: can be added again. */
	leftOn: string | null;
}

interface Pickable {
	person: { type: string; id: string };
}

/**
 * The people you could add: everyone you share with who is not an active
 * member. Someone who left may be added back.
 */
export function membersToAdd<T extends Pickable>(
	people: readonly T[],
	members: readonly MemberLike[],
): T[] {
	const inside = new Set(
		members
			.filter((m) => m.leftOn === null)
			.map((m) => `${m.participantType}:${m.participantId}`),
	);
	return people.filter((p) => !inside.has(`${p.person.type}:${p.person.id}`));
}
