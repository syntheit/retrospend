import type { RetrospendClient } from "@retrospend/api-client";
import type { Outbox, OutboxEntry } from "@/data/outbox";
import type { Sender, SendResult } from "@/data/sync";

// Sends the composers' outbox entries to API v1. The entry's client id is the
// idempotency key and the new row's id, so a retry after a lost answer
// replays the first response instead of writing a second row.

/** Where to send an undo token: each write family has its own undo route. */
export interface UndoRef {
	entity: EntryEntity;
	token: string;
}

export const ENTRY_ENTITIES = [
	"expenses",
	"shared-expenses",
	"income",
] as const;
export type EntryEntity = (typeof ENTRY_ENTITIES)[number];

export function isEntryEntity(entity: string): entity is EntryEntity {
	return (ENTRY_ENTITIES as readonly string[]).includes(entity);
}

/**
 * The outbox as the composers' flush sees it: only their own entities. An
 * entry of another stream has no sender here and must not stop the queue.
 */
export function entryOutbox(outbox: Outbox): Outbox {
	return {
		...outbox,
		pending: async () =>
			(await outbox.pending()).filter((e) => isEntryEntity(e.entity)),
	};
}

type Body<T> = T extends (input: infer I, ...rest: never[]) => unknown
	? I
	: never;

/** A server that keeps answering 5xx for one write is refusing it, not down. */
const MAX_SERVER_ERRORS = 3;

/**
 * Network failures and server trouble retry; a refused write is parked.
 * `attempts` is how often this write already failed: a write must not hold
 * the whole queue forever behind a server error that never clears.
 */
export function classify(error: unknown, attempts = 0): SendResult {
	const { status, code } = (error ?? {}) as { status?: number; code?: string };
	const reason = code ?? (error instanceof Error ? error.message : "unknown");
	// No status: the request never got an answer (offline, timeout).
	if (status === undefined) return { status: "retry", reason };
	// A 401 ends the session on its own; the write waits for the next sign in.
	if (status === 401 || status === 403 || status === 408 || status === 429) {
		return { status: "retry", reason };
	}
	if (status >= 500) {
		return attempts >= MAX_SERVER_ERRORS
			? { status: "conflict", reason }
			: { status: "retry", reason };
	}
	if (code === "idempotency_in_progress") return { status: "retry", reason };
	return { status: "conflict", reason };
}

/**
 * The sender for the composers' entities. `onSent` hears the undo token of
 * each write that went through, so Save can offer Undo right away.
 */
export function createEntrySender(
	api: RetrospendClient,
	onSent?: (entry: OutboxEntry, undo: UndoRef) => void,
): Sender {
	return async (entry) => {
		if (!isEntryEntity(entry.entity)) {
			return { status: "retry", reason: `no sender for ${entry.entity}` };
		}
		const context = { idempotencyKey: entry.clientId };
		try {
			const token = await create(api, entry, { context });
			onSent?.(entry, { entity: entry.entity, token });
			return { status: "sent" };
		} catch (error) {
			return classify(error, entry.attempts);
		}
	};
}

async function create(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: { context: { idempotencyKey: string } },
): Promise<string> {
	switch (entry.entity as EntryEntity) {
		case "expenses":
			return (
				await api.expenses.create(
					entry.payload as Body<typeof api.expenses.create>,
					options,
				)
			).undo;
		case "shared-expenses":
			return (
				await api["shared-expenses"].create(
					entry.payload as Body<(typeof api)["shared-expenses"]["create"]>,
					options,
				)
			).undo;
		case "income":
			return (
				await api.income.create(
					entry.payload as Body<typeof api.income.create>,
					options,
				)
			).undo;
	}
}

/** Puts a saved write back through its family's undo route. */
export async function undoWrite(
	api: RetrospendClient,
	ref: UndoRef,
	clientId: string,
): Promise<void> {
	const options = { context: { idempotencyKey: `${clientId}-undo` } };
	const input = { token: ref.token };
	if (ref.entity === "expenses") await api.expenses.undo(input, options);
	else if (ref.entity === "shared-expenses") {
		await api["shared-expenses"].undo(input, options);
	} else await api.income.undo(input, options);
}
