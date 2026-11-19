import type { PendingChange } from "@retrospend/engine/device";
import { decodeRow, encodeRow } from "./engine-db/serialize";
import type { BaseVersion, DeviceBooking, OutboxEntry } from "./outbox";

// The rules that keep a chain of writes to one row in order: who waits on
// whom, what a stamp is written into, and how an entry is stored. Pure
// functions over entries; outbox.ts owns the store and the order of steps.

/**
 * The columns of an expense that hold a person's text. The outbox is a plain
 * key-value store, so a `device` row never keeps them (design item 2). This
 * list is a copy of the engine's EXPENSE_TEXT_COLUMNS: the engine stays out of
 * a release bundle, so it cannot be imported here. outbox.test holds the two
 * equal, so a new text column fails there.
 */
export const DEVICE_TEXT_COLUMNS = [
	"title",
	"description",
	"location",
] as const;

export const PARKED_CHAIN_LOST = "chain_lost";
/** An entry being taken out of line: parked first, so a crash never sends it. */
export const PARKED_DISCARDING = "discarding";
const REPLACED = "replaced:";
/** An entry being swapped for `clientId`: parked until the swap is done. */
export const parkedReplacedBy = (clientId: string) => `${REPLACED}${clientId}`;
/** The client id an entry was being replaced by, or null when it was not. */
export const replacementOf = (entry: OutboxEntry): string | null =>
	entry.state === "conflict" && entry.lastError?.startsWith(REPLACED)
		? entry.lastError.slice(REPLACED.length)
		: null;

function bare<R extends object | null>(row: R): R {
	if (row === null) return row;
	const out: Record<string, unknown> = { ...row };
	for (const column of DEVICE_TEXT_COLUMNS) delete out[column];
	return out as R;
}

/** `device` as the outbox may keep it: every row without its text. */
export function withoutDeviceText(device: DeviceBooking): DeviceBooking {
	return {
		...device,
		changes: device.changes.map((c) => ({
			...c,
			before: bare(c.before),
			after: bare(c.after),
		})),
	};
}

/** Whether `entry` waits for `clientId` to be acked and wrote its version. */
export function isChainedTo(entry: OutboxEntry, clientId: string): boolean {
	const base = entry.baseVersion;
	return typeof base === "object" && base !== null && base.after === clientId;
}

export const isUnresolved = (base: BaseVersion): base is { after: string } =>
	typeof base === "object" && base !== null;

/**
 * What an entry takes when the entry before it is acked at `version`: its
 * base, and the version of every row of its `before` that the acked one
 * wrote (a device-booked row has none until its ack, and the overlay finds
 * the base of a stacked entry by it).
 */
export function stampedBy(
	dependent: OutboxEntry,
	acked: OutboxEntry,
	version: string,
): Partial<OutboxEntry> {
	const written = new Set(acked.device?.changes.map((c) => c.id));
	const device = dependent.device && {
		...dependent.device,
		changes: dependent.device.changes.map(
			(c): PendingChange =>
				c.before && written.has(c.id)
					? { ...c, before: { ...c.before, version } }
					: c,
		),
	};
	return { baseVersion: version, ...(device ? { device } : {}) };
}

/** A chain that resolves to nothing is parked, never sent. */
export const chainLost: Partial<OutboxEntry> = {
	state: "conflict",
	lastError: PARKED_CHAIN_LOST,
};

/** An entry as one string: dates and decimals survive the trip (engine-db/serialize). */
export function encodeEntry(entry: OutboxEntry): string {
	const { seq: _seq, device, ...rest } = entry;
	return JSON.stringify({
		...rest,
		...(device ? { device: encodeRow(withoutDeviceText(device)) } : {}),
	});
}

export function decodeEntry(text: string, seq: number): OutboxEntry {
	const stored = JSON.parse(text) as Omit<OutboxEntry, "device"> & {
		device?: string;
	};
	const { device, ...rest } = stored;
	return {
		...rest,
		// Entries written before the counters existed read as zero.
		networkFailures: rest.networkFailures ?? 0,
		serverErrors: rest.serverErrors ?? 0,
		seq,
		...(device ? { device: decodeRow(device) as DeviceBooking } : {}),
	};
}
