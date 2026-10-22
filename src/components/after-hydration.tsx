"use client";

import { useHydrated } from "~/hooks/use-hydrated";

/**
 * Renders `fallback` on the server and during hydration, then `children`.
 *
 * Data pages show dates as "Today", "Overdue by 2 days", the current month
 * and so on, all in the browser's time zone and clock. The server runs in
 * another zone (UTC in production), so rendering those pages there produced
 * different text than the browser's hydration render. The prefetched data is
 * already in the query cache, so the page appears right after hydration
 * without another request.
 */
export function AfterHydration({
	fallback,
	children,
}: {
	fallback: React.ReactNode;
	children: React.ReactNode;
}) {
	return useHydrated() ? children : fallback;
}
