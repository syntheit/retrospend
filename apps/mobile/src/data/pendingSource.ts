import type { PendingEntry, PendingSource } from "@retrospend/engine/device";
import type { AckedEntry, Outbox, OutboxEntry } from "./outbox";

// The outbox and the acked list as the device engine's PendingSource. The
// engine reads `entries()` in the middle of a read or a pull and cannot wait,
// so the adapter keeps the last snapshot; the phone calls `refresh()` after
// each enqueue, flush, retire and pull it wants the engine to see.

/**
 * An entry as the engine reads it. An entry the device did not book has no
 * rows but is kept: its payload still names the category it files into, and
 * the create-undo guard must see it (a write never booked, or refused, is
 * still on its way to the server).
 */
function pendingOf(entry: OutboxEntry | AckedEntry): PendingEntry {
	const { device } = entry;
	return {
		clientId: entry.clientId,
		entity: entry.entity,
		targetId: entry.targetId,
		payload: entry.payload,
		bookedAt: device?.bookedAt ?? Date.parse(entry.createdAt),
		changes: device?.changes ?? [],
		changed: device?.changed ?? [],
		parked: entry.state === "conflict",
		...(device?.unbooked ? { unbooked: device.unbooked } : {}),
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
				.map(pendingOf);
		},
		retire(clientIds) {
			const gone = new Set(clientIds);
			list = list.filter((e) => !gone.has(e.clientId));
			// A failed delete leaves the entry on disk: the first pull after the
			// next load retires it again, so the failure costs nothing.
			writes = writes.then(() => outbox.retire(clientIds)).catch(() => {});
		},
		takeLeft: () =>
			outbox
				.takeLeft()
				.map(({ entry, code }) => ({ entry: pendingOf(entry), code })),
		idle: async () => {
			await writes;
		},
	};
}
