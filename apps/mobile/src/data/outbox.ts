import type { PendingChange } from "@retrospend/engine/device";
import {
	chainLost,
	decodeEntry,
	encodeEntry,
	isChainedTo,
	PARKED_DISCARDING,
	PARKED_STAMP,
	parkedReplacedBy,
	replacementOf,
	stampedBy,
	withoutDeviceText,
} from "./outbox-chain";
import type { KeyValueStore } from "./store";

// Writes made on the phone wait here until the server has them. Every entry
// carries the client id (also the idempotency key) and the version the edit
// was based on, so a later sync can tell a clean write from a conflict. A
// conflicting entry is parked, never dropped.
//
// A write the device booked (`device`) is kept after its ack in a second
// list, so the overlay and the write compare can still see it until a pull
// brings the server's row. Both lists live in the one store, in one order.

export type OutboxKind = "create" | "update" | "delete";
/**
 * pending: never tried. sending: a send began (kept after a crash, so a write
 * that may have reached the server is never mistaken for one that did not).
 * failed: the last try did not get through. conflict: parked, never retried.
 */
export type OutboxState = "pending" | "sending" | "failed" | "conflict";

/**
 * The row's `updatedAt` an edit was based on; null for a create. `{ after }`
 * names an earlier entry for the same row that has not been acked: its
 * version is written in when it is.
 */
export type BaseVersion = string | null | { after: string };

/**
 * What the device booked for an entry: each row it changed, before and after,
 * without a title, description or location (the outbox is a plain store), and
 * the names of the fields the person changed. `unbooked` means the device had
 * no rate: the server books it and there are no rows.
 */
export interface DeviceBooking {
	/** Epoch ms the device booked it. */
	bookedAt: number;
	changes: readonly PendingChange[];
	changed: readonly string[];
	unbooked?: "no_rate";
}

export interface OutboxEntry {
	/** Also the Idempotency-Key and, for a create, the new row's id. */
	clientId: string;
	/** The server's entity name, for example "expenses". */
	entity: string;
	kind: OutboxKind;
	/** The row id the write is about (equals clientId for a create). */
	targetId: string;
	baseVersion: BaseVersion;
	/** Plain JSON for the API call. User text stays opaque (owner rule 11). */
	payload: unknown;
	/** The device's own booking of it; never any text. */
	device?: DeviceBooking;
	createdAt: string;
	/** Sends begun, counted before the request leaves: 0 means it never left. */
	attempts: number;
	/** Tries that never got an answer (offline, timeout). Not held against the write. */
	networkFailures: number;
	/** Tries the server answered with a 5xx. */
	serverErrors: number;
	state: OutboxState;
	lastError: string | null;
	/**
	 * The sealed request a vault transport built at the first send (K9), kept so
	 * a retry resends the same bytes under the same key. Ciphertext only: never
	 * a title, a note or the plaintext it was sealed from.
	 */
	sealed?: string;
	/** Its place in the order, read from the store: never written. */
	seq?: number;
}

/** A write the server took, kept until a pull shows its row. */
export interface AckedEntry extends OutboxEntry {
	ack: {
		/** The `updatedAt` the answer named for the row; null for a delete. */
		version: string | null;
		/** The device engine's pulls begun at the ack, 0 for one read from disk. */
		pull: number;
	};
	ackedAt: string;
}

export type NewOutboxEntry = Pick<
	OutboxEntry,
	"clientId" | "entity" | "kind" | "targetId" | "baseVersion" | "payload"
> &
	Partial<Pick<OutboxEntry, "device" | "sealed" | "attempts">>;

export interface Ack {
	/** The `updatedAt` from the answer; null for a delete, absent when it named none. */
	version?: string | null;
	/**
	 * `DeviceEngine.pullsBegun` as the answer arrived. Left out, it is unknown
	 * and the acked entry fails closed: no pull of this run retires it (a
	 * restart reads it as 0, as designed).
	 */
	pull?: number;
}

export interface Outbox {
	enqueue(entry: NewOutboxEntry): Promise<OutboxEntry>;
	/** Entries still to send, oldest first. */
	pending(): Promise<OutboxEntry[]>;
	/** Everything, for the "waiting to sync" count and a future conflict UI. */
	all(): Promise<OutboxEntry[]>;
	/** A send is about to leave: counted first, so a crash leaves the trace. */
	markSending(clientId: string): Promise<void>;
	/**
	 * The server took it. Alone in one step: the entries chained after it take
	 * its version, a device-booked entry moves to the acked list, and the entry
	 * leaves the outbox. An entry chained after it with no version to take
	 * (a delete, or an answer that named none) is parked as chain_lost.
	 */
	markSent(clientId: string, ack?: Ack): Promise<void>;
	/** Keeps the sealed request of an entry before its request leaves (see `OutboxEntry.sealed`). */
	seal(clientId: string, bytes: string): Promise<void>;
	/** `network`: no answer. `server`: a 5xx. */
	markFailed(
		clientId: string,
		error: string,
		kind?: "network" | "server",
	): Promise<void>;
	markConflict(clientId: string, error: string): Promise<void>;
	/**
	 * Removes an entry the person took back before the server had it. Entries
	 * chained after it rest on its own base; with none (a create), they park.
	 */
	discard(clientId: string): Promise<void>;
	/**
	 * Swaps an entry for a new one in the same place (a re-base). Every later
	 * entry for the same row is parked as `expense_changed`: it was written for
	 * a version the re-base moved past, so it is re-based on its own.
	 */
	replace(clientId: string, entry: NewOutboxEntry): Promise<OutboxEntry | null>;
	/** Puts a parked entry back in line, with its server-error count cleared. */
	requeue(clientId: string): Promise<void>;
	/** Both lists in one read, so an entry moving between them is seen once. */
	snapshot(): Promise<{ open: OutboxEntry[]; acked: AckedEntry[] }>;
	/** The acked list, oldest first, without what is past 200 entries or 7 days. */
	acked(): Promise<AckedEntry[]>;
	/** Takes entries out of the acked list: a pull compared them. */
	retire(clientIds: readonly string[]): Promise<void>;
	/** Takes an entry out of the acked list because the person undid it. */
	undone(clientId: string): Promise<void>;
	/** Entries that left the acked list without a pull, once each. */
	takeLeft(): { entry: AckedEntry; code: "undone" | "expired" }[];
	/**
	 * Raises and returns this write's undo generation, written before the undo
	 * request leaves: its key is `${clientId}-undo-${n}`.
	 */
	nextUndoGeneration(clientId: string): Promise<number>;
	/** Sign out: both lists, the sequence and the undo generations. */
	clear(): Promise<void>;
}

const SEQ_WIDTH = 10;
export const ACKED_MAX = 200;
export const ACKED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createOutbox(
	store: KeyValueStore,
	scope: string,
	now: () => Date = () => new Date(),
): Outbox {
	const prefix = `outbox:${scope}:`;
	const ackedPrefix = `acked:${scope}:`;
	const undoPrefix = `undoGen:${scope}:`;
	const seqKey = `outboxSeq:${scope}`;
	// The pull generation of an ack is this run's: a number read from disk
	// belongs to a run whose pulls the engine no longer counts.
	const ackPulls = new Map<string, number>();
	const left: { entry: AckedEntry; code: "undone" | "expired" }[] = [];
	// One operation at a time, so two enqueues never take the same sequence.
	let queue: Promise<unknown> = Promise.resolve();
	// A discard or replace that a crash cut short is finished before the first
	// operation of a run. If that fails the entries stay parked, never sent.
	let recovered = false;
	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const next = queue.then(async () => {
			if (!recovered) {
				recovered = true;
				await finishCutShort().catch(() => {
					recovered = false;
				});
			}
			return task();
		}, task);
		queue = next.catch(() => undefined);
		return next;
	};

	const seqOf = (key: string, from: string) =>
		Number(key.slice(from.length, from.length + SEQ_WIDTH));

	async function keyFor(clientId: string): Promise<string | null> {
		const keys = await store.keys(prefix);
		return keys.find((k) => k.endsWith(`:${clientId}`)) ?? null;
	}

	async function read(key: string): Promise<OutboxEntry | null> {
		const raw = await store.get(key);
		return raw ? decodeEntry(raw, seqOf(key, prefix)) : null;
	}

	async function write(key: string, entry: OutboxEntry) {
		await store.set(key, encodeEntry(entry));
	}

	async function update(
		clientId: string,
		patch: (entry: OutboxEntry) => Partial<OutboxEntry>,
	) {
		const key = await keyFor(clientId);
		const entry = key ? await read(key) : null;
		if (!key || !entry) return;
		await write(key, { ...entry, ...patch(entry) });
	}

	async function load(): Promise<OutboxEntry[]> {
		const entries: OutboxEntry[] = [];
		for (const key of await store.keys(prefix)) {
			const entry = await read(key);
			if (entry) entries.push(entry);
		}
		return entries;
	}

	/** Gives every entry chained after `clientId` the patch `change` makes, in place. */
	async function forDependents(
		clientId: string,
		change: (dependent: OutboxEntry) => Partial<OutboxEntry>,
	) {
		for (const key of await store.keys(prefix)) {
			const entry = await read(key);
			if (entry && isChainedTo(entry, clientId))
				await write(key, { ...entry, ...change(entry) });
		}
	}

	async function loadAcked(): Promise<AckedEntry[]> {
		const entries: AckedEntry[] = [];
		for (const key of await store.keys(ackedPrefix)) {
			const raw = await store.get(key);
			if (!raw) continue;
			const entry = decodeEntry(raw, seqOf(key, ackedPrefix)) as AckedEntry;
			entries.push({
				...entry,
				ack: { ...entry.ack, pull: ackPulls.get(entry.clientId) ?? 0 },
			});
		}
		return entries;
	}

	const ackedKey = (e: AckedEntry) =>
		`${ackedPrefix}${String(e.seq).padStart(SEQ_WIDTH, "0")}:${e.clientId}`;

	async function drop(entry: AckedEntry, code: "undone" | "expired") {
		await store.delete(ackedKey(entry));
		ackPulls.delete(entry.clientId);
		left.push({ entry, code });
	}

	/** Past 7 days, or past the newest 200, leaves the list as `expired`. */
	async function prune(): Promise<AckedEntry[]> {
		const list = await loadAcked();
		const oldest = now().getTime() - ACKED_MAX_AGE_MS;
		const kept: AckedEntry[] = [];
		for (const entry of list) {
			if (Date.parse(entry.ackedAt) < oldest) await drop(entry, "expired");
			else kept.push(entry);
		}
		for (const entry of kept.splice(0, Math.max(0, kept.length - ACKED_MAX)))
			await drop(entry, "expired");
		return kept;
	}

	async function settle(clientId: string, answer: Ack = {}) {
		const key = await keyFor(clientId);
		const entry = key ? await read(key) : null;
		if (!key || !entry) return;
		const version = answer.version;
		// Dependents first: a crash after this leaves the entry in the outbox,
		// to be sent again under the same key.
		await forDependents(clientId, (dep) =>
			typeof version === "string" ? stampedBy(dep, entry, version) : chainLost,
		);
		if (entry.device && !entry.device.unbooked) {
			ackPulls.set(clientId, answer.pull ?? Number.POSITIVE_INFINITY);
			// The sealed request has done its work once the server answered.
			const { sealed: _sealed, ...kept } = entry;
			const record = {
				...kept,
				ack: { version: version ?? null },
				ackedAt: now().toISOString(),
			};
			await store.set(
				`${ackedPrefix}${key.slice(prefix.length)}`,
				encodeEntry(record as OutboxEntry),
			);
		}
		await store.delete(key);
		await prune();
	}

	async function discard(clientId: string) {
		const key = await keyFor(clientId);
		const entry = key ? await read(key) : null;
		if (!key || !entry) return;
		// Unsendable first, then its dependents, then gone: a crash on the way
		// never sends a write the person took back.
		await write(key, {
			...entry,
			state: "conflict",
			lastError: PARKED_DISCARDING,
		});
		await finishDiscard(key, entry);
	}

	async function finishDiscard(key: string, entry: OutboxEntry) {
		const base = entry.baseVersion;
		await forDependents(entry.clientId, () =>
			base === null ? chainLost : { baseVersion: base },
		);
		await store.delete(key);
	}

	async function replace(clientId: string, input: NewOutboxEntry) {
		// Every re-base is a new write under a new key: the old key is the
		// replaced entry's, and a crash leaves it to tell the two apart.
		if (input.clientId === clientId)
			throw new Error("A replacement needs a new clientId");
		const key = await keyFor(clientId);
		const old = key ? await read(key) : null;
		if (!key || !old) return null;
		const entry = fresh(input);
		const next = `${prefix}${key.slice(prefix.length, prefix.length + SEQ_WIDTH)}:${input.clientId}`;
		// The old entry is parked, the new one written, the dependents moved
		// over and only then the old one deleted: a crash on the way leaves one
		// entry that can be sent, never none and never both.
		await write(key, {
			...old,
			state: "conflict",
			lastError: parkedReplacedBy(input.clientId),
		});
		await write(next, entry);
		await finishReplace(key, old.targetId);
		return entry;
	}

	/**
	 * A re-based entry rests on a newer version than the entries after it were
	 * written for, so none of them may follow it: each later entry for the row
	 * is parked as a conflict, never sent and never given a stamp, and is
	 * re-based on its own. Its chain reference stays as it was.
	 */
	async function finishReplace(key: string, target: string) {
		const slot = seqOf(key, prefix);
		for (const other of await store.keys(prefix)) {
			const later = await read(other);
			if (later && later.targetId === target && (later.seq ?? 0) > slot)
				await write(other, {
					...later,
					state: "conflict",
					lastError: PARKED_STAMP,
				});
		}
		await store.delete(key);
	}

	/** A leftover "discarding" is finished; a leftover "replaced" once its replacement exists. */
	async function finishCutShort() {
		const entries = await load();
		const acked = await loadAcked();
		for (const entry of entries) {
			const key = await keyFor(entry.clientId);
			if (!key) continue;
			if (entry.state === "conflict" && entry.lastError === PARKED_DISCARDING)
				await finishDiscard(key, entry);
			const by = replacementOf(entry);
			if (by && [...entries, ...acked].some((e) => e.clientId === by))
				await finishReplace(key, entry.targetId);
		}
	}

	function fresh(input: NewOutboxEntry): OutboxEntry {
		return {
			...input,
			...(input.device ? { device: withoutDeviceText(input.device) } : {}),
			createdAt: now().toISOString(),
			// Only a put-back entry whose send began brings its count.
			attempts: input.attempts ?? 0,
			networkFailures: 0,
			serverErrors: 0,
			state: "pending",
			lastError: null,
		};
	}

	return {
		enqueue: (input) =>
			serial(async () => {
				const seq = Number((await store.get(seqKey)) ?? "0") + 1;
				await store.set(seqKey, String(seq));
				const entry = fresh(input);
				const key = `${prefix}${String(seq).padStart(SEQ_WIDTH, "0")}:${input.clientId}`;
				await write(key, entry);
				return { ...entry, seq };
			}),
		all: () => serial(load),
		pending: () =>
			serial(async () => (await load()).filter((e) => e.state !== "conflict")),
		markSending: (clientId) =>
			serial(() =>
				update(clientId, (e) => ({
					state: "sending",
					attempts: e.attempts + 1,
				})),
			),
		markSent: (clientId, answer) => serial(() => settle(clientId, answer)),
		seal: (clientId, bytes) =>
			serial(() => update(clientId, () => ({ sealed: bytes }))),
		markFailed: (clientId, error, kind = "network") =>
			serial(() =>
				update(clientId, (e) => ({
					state: "failed",
					lastError: error,
					networkFailures: e.networkFailures + (kind === "network" ? 1 : 0),
					serverErrors: e.serverErrors + (kind === "server" ? 1 : 0),
				})),
			),
		markConflict: (clientId, error) =>
			serial(() =>
				update(clientId, () => ({ state: "conflict", lastError: error })),
			),
		requeue: (clientId) =>
			serial(() =>
				// A write being taken out of line or swapped for another is never put back.
				update(clientId, (e) =>
					e.lastError === PARKED_DISCARDING || replacementOf(e)
						? {}
						: { state: "pending", lastError: null, serverErrors: 0 },
				),
			),
		discard: (clientId) => serial(() => discard(clientId)),
		replace: (clientId, input) => serial(() => replace(clientId, input)),
		snapshot: () =>
			serial(async () => ({ open: await load(), acked: await prune() })),
		acked: () => serial(prune),
		retire: (clientIds) =>
			serial(async () => {
				for (const entry of await loadAcked()) {
					if (!clientIds.includes(entry.clientId)) continue;
					await store.delete(ackedKey(entry));
					ackPulls.delete(entry.clientId);
				}
			}),
		undone: (clientId) =>
			serial(async () => {
				const entry = (await loadAcked()).find((e) => e.clientId === clientId);
				if (entry) await drop(entry, "undone");
			}),
		takeLeft: () => left.splice(0),
		nextUndoGeneration: (clientId) =>
			serial(async () => {
				const key = `${undoPrefix}${clientId}`;
				const n = Number((await store.get(key)) ?? "0") + 1;
				await store.set(key, String(n));
				return n;
			}),
		clear: () =>
			serial(async () => {
				for (const from of [prefix, ackedPrefix, undoPrefix])
					for (const key of await store.keys(from)) await store.delete(key);
				await store.delete(seqKey);
				ackPulls.clear();
				left.length = 0;
			}),
	};
}
