import { useEffect, useMemo } from "react";
import { useSession } from "@/auth/session";
import { subscribeEntryChanges } from "@/features/entry/events";
import { ENTITY_CACHE_LIMIT } from "@/features/read/loadCached";
import { useCachedRead } from "@/features/read/useCachedRead";
import {
	fetchProject,
	fetchProjects,
	fetchSummary,
	PROJECTS_CACHE,
	projectCache,
	summaryCache,
} from "./source";

/** The Projects list, cache first. */
export function useProjectList() {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchProjects(api) : null), [api]);
	const read = useCachedRead(PROJECTS_CACHE, fetch);
	const { reload } = read;
	// A project made, changed or archived from a sheet.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);
	return read;
}

/** One project's page, cache first. */
export function useProject(id: string) {
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchProject(api, id) : null), [api, id]);
	return useCachedRead(projectCache(id), fetch, {
		prefix: "project.",
		keep: ENTITY_CACHE_LIMIT,
	});
}

/** A project's Summary tab: the whole project, or one billing period. */
export function useProjectSummary(
	id: string,
	periodId: string | null,
	enabled: boolean,
) {
	const { api } = useSession();
	const fetch = useMemo(
		() => (api && enabled ? fetchSummary(api, id, periodId) : null),
		[api, id, periodId, enabled],
	);
	// No key until the tab is open: the read starts when the key appears.
	return useCachedRead(enabled ? summaryCache(id, periodId) : null, fetch, {
		prefix: "project.",
		keep: ENTITY_CACHE_LIMIT,
	});
}
