import type { PendingEntry, PendingSource } from "@retrospend/engine/device";
import type { AckedEntry, Outbox, OutboxEntry } from "./outbox";

// The outbox and the acked list as the device engine's PendingSource. The
// engine reads `entries()` in the middle of a read or a pull and cannot wait,
// so the adapter keeps the last snapshot; the phone calls `refresh()` after
// each enqueue, flush, retire and pull it wants the engine to see.

/** An entry as the engine reads it; null for one the device did not book. */
function pendingOf(entry: OutboxEntry | AckedEntry): PendingEntry | null {
	const { device } = entry;
	if (!device) return null;
	return {
		clientId: entry.clientId,
		bookedAt: device.bookedAt,
		changes: device.changes,
		changed: device.changed,
		parked: entry.state === "conflict",
		...(device.unbooked ? { unbooked: device.unbooked } : {}),
		...("ack" in entry ? { ack: entry.ack } : {}),
	};
}

export interface OutboxPending extends PendingSource {
	/** Reads both lists again. */
	refresh(): Promise<void>;
	/** Resolves when the retires the engine asked for have reached the store. */
	idle(): Promise<void>;
}

export function createPendingSource(outbox: Outbox): OutboxPending {
	let list: PendingEntry[] = [];
	let writes: Promise<unknown> = Promise.resolve();
	return {
		entries: () => list,
		refresh: async () => {
			const { open, acked } = await outbox.snapshot();
			list = [...open, ...acked]
				.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
				.flatMap((e) => pendingOf(e) ?? []);
		},
		retire(clientIds) {
			const gone = new Set(clientIds);
			list = list.filter((e) => !gone.has(e.clientId));
			// A failed delete leaves the entry on disk: the first pull after the
			// next load retires it again, so the failure costs nothing.
			writes = writes.then(() => outbox.retire(clientIds)).catch(() => {});
		},
		takeLeft: () =>
			outbox.takeLeft().flatMap(({ entry, code }) => {
				const pending = pendingOf(entry);
				return pending ? [{ entry: pending, code }] : [];
			}),
		idle: async () => {
			await writes;
		},
	};
}
