/**
 * Lookup of people by participant identity (type + id), for timeline rows
 * that need a person's avatar and profile link. Names are not unique, so
 * they never serve as keys.
 */

export type PersonIdentity = {
	participantType: string;
	participantId: string;
	avatarUrl: string | null;
};

export type PersonLookupEntry = {
	avatarUrl: string | null;
	href: string;
};

export function participantKey(type: string, id: string): string {
	return `${type}:${id}`;
}

export function buildPeopleLookup(
	people: readonly PersonIdentity[],
): Map<string, PersonLookupEntry> {
	const map = new Map<string, PersonLookupEntry>();
	for (const p of people) {
		map.set(participantKey(p.participantType, p.participantId), {
			avatarUrl: p.avatarUrl,
			href: `/people/${p.participantType}/${p.participantId}`,
		});
	}
	return map;
}

export function findPerson(
	lookup: Map<string, PersonLookupEntry>,
	type: string | undefined,
	id: string | undefined,
): PersonLookupEntry | undefined {
	if (!type || !id) return undefined;
	return lookup.get(participantKey(type, id));
}
