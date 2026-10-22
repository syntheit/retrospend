import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards (and right away
 * on client-side renders). Gate output that depends on the browser's clock or
 * time zone with it, so the hydration render matches the server HTML.
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}
