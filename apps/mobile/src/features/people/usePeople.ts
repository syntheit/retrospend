import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { useCachedRead } from "@/features/read/useCachedRead";
import {
	fetchOverview,
	fetchPerson,
	OVERVIEW_CACHE,
	type PersonRef,
	personCache,
} from "./source";

/** The People overview, cache first. Also feeds the person filter in Activity. */
export function usePeopleOverview() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchOverview(api) : null), [api]);
	return useCachedRead(OVERVIEW_CACHE, fetch);
}

/** One person's page, cache first. */
export function usePerson(ref: PersonRef) {
	const { api } = useSession();
	const fetch = useMemo(
		() => (api ? fetchPerson(api, { type: ref.type, id: ref.id }) : null),
		[api, ref.type, ref.id],
	);
	return useCachedRead(personCache(ref), fetch);
}
