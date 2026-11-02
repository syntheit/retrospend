import type { OutboxEntry } from "@/data/outbox";

// An entry leaves the outbox the moment the server has it, a beat before the
// lists have read the server's row. Lists keep the sent entries from here
// until their own read settles, so the row never blinks out between the two.

/** Long enough for a slow read; the lists let go sooner, when their read lands. */
const KEEP_MS = 20_000;

const sent = new Map<string, { entry: OutboxEntry; at: number }>();

export function retainSent(
	entries: readonly OutboxEntry[],
	now: number = Date.now(),
): void {
	for (const entry of entries) sent.set(entry.clientId, { entry, at: now });
}

/** The entries sent in the last few seconds, oldest first. */
export function recentlySent(now: number = Date.now()): OutboxEntry[] {
	for (const [id, { at }] of sent) if (now - at > KEEP_MS) sent.delete(id);
	return [...sent.values()].map((s) => s.entry);
}

/** The entry was taken back (Undo, Delete): it must not show as sent. */
export function releaseSent(clientId: string): void {
	sent.delete(clientId);
}

/** Test seam. */
export function forgetSent(): void {
	sent.clear();
}
