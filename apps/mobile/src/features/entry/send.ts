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
/** No answer for this long counts as no network; the write waits in the outbox. */
export const SEND_TIMEOUT_MS = 10_000;

/** What the server said the first time, kept so Undo can find the token. */
const sentTokens = new Map<string, UndoRef>();
const MAX_TOKENS = 50;

export function rememberUndo(clientId: string, ref: UndoRef): void {
	sentTokens.set(clientId, ref);
	// Oldest first: a Map iterates in insertion order.
	while (sentTokens.size > MAX_TOKENS) {
		const oldest = sentTokens.keys().next().value;
		if (oldest === undefined) break;
		sentTokens.delete(oldest);
	}
}

/** Test seam: forget every kept token. */
export function forgetUndoTokens(): void {
	sentTokens.clear();
}

export function undoFor(clientId: string): UndoRef | undefined {
	return sentTokens.get(clientId);
}

/** A client-made id that the server already holds: an earlier try got through. */
function idTaken(error: unknown): boolean {
	const { status, code, message } = (error ?? {}) as {
		status?: number;
		code?: string;
		message?: string;
	};
	return (
		status === 409 &&
		code === "conflict" &&
		typeof message === "string" &&
		message.includes("already used")
	);
}

/**
 * Network failures and server trouble retry; a refused write is parked.
 * `serverErrors` is how often this write already met a 5xx: a write must not
 * hold the whole queue forever behind a server error that never clears.
 */
export function classify(error: unknown, serverErrors = 0): SendResult {
	const { status, code } = (error ?? {}) as { status?: number; code?: string };
	const reason = code ?? (error instanceof Error ? error.message : "unknown");
	// No status: the request never got an answer (offline, timeout).
	if (status === undefined) return { status: "retry", reason, kind: "network" };
	// A 401 ends the session on its own; the write waits for the next sign in.
	// A token without the scope may get it after a re-authorization.
	if (
		status === 401 ||
		status === 408 ||
		status === 429 ||
		code === "missing_scope" ||
		code === "idempotency_in_progress"
	) {
		return { status: "retry", reason, kind: "network" };
	}
	if (status >= 500) {
		return serverErrors >= MAX_SERVER_ERRORS
			? { status: "conflict", reason }
			: { status: "retry", reason, kind: "server" };
	}
	// 400, 403, 404, 409, 422: the server read it and said no.
	return { status: "conflict", reason };
}

export interface SenderOptions {
	/** Stops the run: the account changed, so nothing more is sent. */
	signal?: AbortSignal;
}

/** The sender for the composers' entities. Undo tokens are kept for Undo. */
export function createEntrySender(
	api: RetrospendClient,
	options: SenderOptions = {},
): Sender {
	return async (entry) => {
		if (!isEntryEntity(entry.entity)) {
			return { status: "retry", reason: `no sender for ${entry.entity}` };
		}
		if (options.signal?.aborted) {
			return { status: "retry", reason: "aborted", kind: "network" };
		}
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
		const stop = () => timeout.abort();
		options.signal?.addEventListener("abort", stop);
		try {
			const token = await create(api, entry, {
				context: { idempotencyKey: entry.clientId },
				signal: timeout.signal,
			});
			rememberUndo(entry.clientId, { entity: entry.entity, token });
			return { status: "sent" };
		} catch (error) {
			// The id exists: an earlier try went through and its answer got lost.
			if (idTaken(error)) return { status: "sent" };
			return classify(error, entry.serverErrors);
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", stop);
		}
	};
}

interface CallOptions {
	context: { idempotencyKey: string };
	signal: AbortSignal;
}

async function create(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
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
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = {
		context: { idempotencyKey: `${clientId}-undo` },
		signal: timeout.signal,
	};
	const input = { token: ref.token };
	try {
		if (ref.entity === "expenses") await api.expenses.undo(input, options);
		else if (ref.entity === "shared-expenses") {
			await api["shared-expenses"].undo(input, options);
		} else await api.income.undo(input, options);
	} finally {
		clearTimeout(timer);
	}
}
