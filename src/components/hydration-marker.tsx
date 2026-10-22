"use client";

import { useEffect } from "react";

/**
 * Sets data-hydrated="true" on <html> once React has hydrated the root, so
 * end-to-end tests can wait for a page that answers clicks (a click before
 * hydration does nothing; see docs/ui/GAPS.md). Renders nothing.
 */
export function HydrationMarker() {
	useEffect(() => {
		document.documentElement.dataset.hydrated = "true";
	}, []);
	return null;
}
