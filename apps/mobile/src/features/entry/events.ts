// A tiny signal for screens that list entries (Home, Activity, People): an
// entry was added, undone or finally sent from the outbox, so refetch. The
// composer does not know those screens and they do not know the composer.

import { invalidateReads } from "@/features/read/readLedger";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeEntryChanges(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function announceEntryChange(): void {
	// Whatever was read before this no longer counts as fresh.
	invalidateReads();
	for (const listener of [...listeners]) listener();
}
