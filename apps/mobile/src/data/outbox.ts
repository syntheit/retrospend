import type { KeyValueStore } from "./store";

// Writes made on the phone wait here until the server has them. Every entry
// carries the client id (also the idempotency key) and the version the edit
// was based on, so a later sync can tell a clean write from a conflict. There
// is no conflict UI yet: a conflicting entry is parked, never dropped.

export type OutboxKind = "create" | "update" | "delete";
export type OutboxState = "pending" | "failed" | "conflict";

export interface OutboxEntry {
	/** Also the Idempotency-Key and, for a create, the new row's id. */
	clientId: string;
	/** The server's entity name, for example "expenses". */
	entity: string;
	kind: OutboxKind;
	/** The row id the write is about (equals clientId for a create). */
	targetId: string;
	/** The row's `updatedAt` the edit was based on; null for a create. */
	baseVersion: string | null;
	/** Plain JSON for the API call. User text stays opaque (owner rule 11). */
	payload: unknown;
	createdAt: string;
	attempts: number;
	state: OutboxState;
	lastError: string | null;
}

export type NewOutboxEntry = Pick<
	OutboxEntry,
	"clientId" | "entity" | "kind" | "targetId" | "baseVersion" | "payload"
>;

export interface Outbox {
	enqueue(entry: NewOutboxEntry): Promise<OutboxEntry>;
	/** Entries still to send, oldest first. */
	pending(): Promise<OutboxEntry[]>;
	/** Everything, for the "waiting to sync" count and a future conflict UI. */
	all(): Promise<OutboxEntry[]>;
	markSent(clientId: string): Promise<void>;
	markFailed(clientId: string, error: string): Promise<void>;
	markConflict(clientId: string, error: string): Promise<void>;
	/** Sign out. */
	clear(): Promise<void>;
}

const SEQ_WIDTH = 10;

export function createOutbox(
	store: KeyValueStore,
	scope: string,
	now: () => Date = () => new Date(),
): Outbox {
	const prefix = `outbox:${scope}:`;
	const seqKey = `outboxSeq:${scope}`;
	// One operation at a time, so two enqueues never take the same sequence.
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const next = queue.then(task, task);
		queue = next.catch(() => undefined);
		return next;
	};

	async function keyFor(clientId: string): Promise<string | null> {
		const keys = await store.keys(prefix);
		return keys.find((k) => k.endsWith(`:${clientId}`)) ?? null;
	}

	async function read(key: string): Promise<OutboxEntry | null> {
		const raw = await store.get(key);
		return raw ? (JSON.parse(raw) as OutboxEntry) : null;
	}

	async function update(
		clientId: string,
		patch: (entry: OutboxEntry) => Partial<OutboxEntry>,
	) {
		const key = await keyFor(clientId);
		const entry = key ? await read(key) : null;
		if (!key || !entry) return;
		await store.set(key, JSON.stringify({ ...entry, ...patch(entry) }));
	}

	async function load(): Promise<OutboxEntry[]> {
		const entries: OutboxEntry[] = [];
		for (const key of await store.keys(prefix)) {
			const entry = await read(key);
			if (entry) entries.push(entry);
		}
		return entries;
	}

	return {
		enqueue: (input) =>
			serial(async () => {
				const seq = Number((await store.get(seqKey)) ?? "0") + 1;
				await store.set(seqKey, String(seq));
				const entry: OutboxEntry = {
					...input,
					createdAt: now().toISOString(),
					attempts: 0,
					state: "pending",
					lastError: null,
				};
				const key = `${prefix}${String(seq).padStart(SEQ_WIDTH, "0")}:${input.clientId}`;
				await store.set(key, JSON.stringify(entry));
				return entry;
			}),
		all: () => serial(load),
		pending: () =>
			serial(async () =>
				(await load()).filter(
					(e) => e.state === "pending" || e.state === "failed",
				),
			),
		markSent: (clientId) =>
			serial(async () => {
				const key = await keyFor(clientId);
				if (key) await store.delete(key);
			}),
		markFailed: (clientId, error) =>
			serial(() =>
				update(clientId, (e) => ({
					state: "failed",
					lastError: error,
					attempts: e.attempts + 1,
				})),
			),
		markConflict: (clientId, error) =>
			serial(() =>
				update(clientId, () => ({ state: "conflict", lastError: error })),
			),
		clear: () =>
			serial(async () => {
				for (const key of await store.keys(prefix)) await store.delete(key);
				await store.delete(seqKey);
			}),
	};
}
