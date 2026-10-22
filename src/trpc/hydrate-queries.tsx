"use client";

import {
	type DehydratedState,
	hydrate,
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
	useMemo(() => hydrate(client, state), [client, state]);
	return children;
}
