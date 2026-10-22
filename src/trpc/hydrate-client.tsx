"use client";

import { type DehydratedState, HydrationBoundary } from "@tanstack/react-query";
import { useMemo } from "react";
import { deferPendingQueries } from "./hydration";

/**
 * HydrationBoundary that renders the same query state during SSR and the
 * browser's hydration pass (see deferPendingQueries).
 */
export function StableHydrationBoundary({
	state,
	children,
}: {
	state: DehydratedState;
	children: React.ReactNode;
}) {
	const deferred = useMemo(() => deferPendingQueries(state), [state]);
	return <HydrationBoundary state={deferred}>{children}</HydrationBoundary>;
}
