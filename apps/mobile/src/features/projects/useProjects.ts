import { useMemo } from "react";
import { useSession } from "@/auth/session";
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
	return useCachedRead(PROJECTS_CACHE, fetch);
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
	return useCachedRead(summaryCache(id, periodId), fetch, {
		prefix: "project.",
		keep: ENTITY_CACHE_LIMIT,
	});
}
