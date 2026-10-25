import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

// People, Person and the Settle up read, all from API v1. Shapes are the
// contract's own, so a server change shows up here as a type error.

export type PeopleOverview = Awaited<
	ReturnType<RetrospendClient["people"]["list"]>
>;
export type PersonSummary = PeopleOverview["people"][number];
export type PersonPage = Awaited<ReturnType<RetrospendClient["people"]["get"]>>;
export type PersonIdentity = PersonPage["person"];
export type NeedsItem = PeopleOverview["needs"][number];
export type SettleContext = Awaited<
	ReturnType<RetrospendClient["people"]["settle"]>
>;
export type ParticipantType = PersonIdentity["type"];

export interface PersonRef {
	type: ParticipantType;
	id: string;
}

export const OVERVIEW_CACHE: CacheKey = { name: "people.overview", schema: 1 };

export function personCache(ref: PersonRef): CacheKey {
	return { name: `person.${ref.type}.${ref.id}`, schema: 1 };
}

/** `<type>:<id>`, the key the figures, the bar and Activity name a person by. */
export function keyOf(ref: PersonRef): string {
	return `${ref.type}:${ref.id}`;
}

export function refOfKey(key: string): PersonRef | null {
	const at = key.indexOf(":");
	const type = key.slice(0, at);
	if (at < 1 || (type !== "user" && type !== "guest" && type !== "shadow")) {
		return null;
	}
	return { type, id: key.slice(at + 1) };
}

export function fetchOverview(api: RetrospendClient) {
	return () => api.people.list();
}

export function fetchPerson(api: RetrospendClient, ref: PersonRef) {
	return () => api.people.get(ref);
}
