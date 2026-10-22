"use client";

import {
	type DehydratedState,
	hydrate,
	type QueryClient,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * Puts the server's prefetched data into the query cache before its children
 * render, on the server and in the browser alike.
 *
 * TanStack's HydrationBoundary only fills queries that are not in the cache
 * yet during render; queries that already exist get the data in an effect.
 * Something above a page (the command palette, say) often creates the page's
 * query first, empty. Effects never run during SSR, so the server rendered
 * the page's loading state while the browser rendered it with data: React
 * hydration error 418. hydrate() only notifies observers through TanStack's
 * batched scheduler, so doing it here does not update other components
 * during this render.
 */
export function HydrateQueries({
	state,
	children,
}: {
	state: DehydratedState;
	children: React.ReactNode;
}) {
	const client = useQueryClient();
	useMemo(() => hydrateAsStale(client, state), [client, state]);
	return children;
}

/**
 * Hydrates `state` and marks every query in it stale, so the first component
 * that uses one refetches it in the background (the data still shows at once).
 *
 * The payload can be older than it looks. Next prefetches a page's layouts
 * when a link to it is on screen and reuses them on navigation, so a
 * dashboard payload can predate a budget change made since. The mutation's
 * invalidation found no dashboard query to mark (it did not exist yet), and
 * the hydrated data looked fresh for staleTime, so the stale card stayed.
 */
export function hydrateAsStale(client: QueryClient, state: DehydratedState) {
	hydrate(client, state);
	const cache = client.getQueryCache();
	for (const { queryHash } of state.queries) {
		cache.get(queryHash)?.invalidate();
	}
}
