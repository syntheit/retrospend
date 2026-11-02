import { useEffect, useSyncExternalStore } from "react";

/**
 * Who takes the system Back before the navigator does: an open search view, a
 * header search bar. While any of them is active a back gesture does not pop a
 * screen, so the back preview (layout/predictiveBack) stands down instead of
 * showing a pop that will not happen. A consumer marks itself with
 * `useBackConsumer(active)` for as long as it would handle Back.
 */
let consumers = 0;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Marks the caller as a back consumer while `active` is true. */
export function useBackConsumer(active: boolean): void {
	useEffect(() => {
		if (!active) return;
		consumers += 1;
		emit();
		return () => {
			consumers -= 1;
			emit();
		};
	}, [active]);
}

/** True while something other than the navigator handles Back. */
export function useHasBackConsumer(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => consumers > 0,
		() => false,
	);
}

/** Test seam: the number of active consumers. */
export function backConsumerCount(): number {
	return consumers;
}
