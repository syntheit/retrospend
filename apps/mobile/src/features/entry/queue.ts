import type { RetrospendClient } from "@retrospend/api-client";
import type { Outbox } from "@/data/outbox";
import { flushOutbox } from "@/data/sync";
import type { PendingWrite } from "./draft";
import {
	createEntrySender,
	entryOutbox,
	SEND_TIMEOUT_MS,
	type SenderOptions,
	type UndoRef,
	undoFor,
	undoWrite,
} from "./send";

// Save and Undo for the composers. Every write goes through the outbox first
// (the phone is offline-first), then one flush tries to send it: online it
// ends with the server's undo token, offline it waits in the outbox.
//
// One thing may touch the outbox's entries at a time: a flush (from Save, the
// foreground, the network coming back) or an Undo. Without that, Undo could
// delete an entry whose send is in flight, and the server would keep a write
// the person took back.

const queues = new WeakMap<Outbox, Promise<unknown>>();

/** Runs `task` after everything queued before it on this outbox has ended. */
export function exclusive<T>(
	outbox: Outbox,
	task: () => Promise<T>,
): Promise<T> {
	const before = queues.get(outbox) ?? Promise.resolve();
	const run = before.then(task, task);
	queues.set(
		outbox,
		run.catch(() => undefined),
	);
	return run;
}

/** One flush of the composers' entries, alone on the outbox. */
export function flushEntries(
	outbox: Outbox,
	api: RetrospendClient,
	options?: SenderOptions,
) {
	return exclusive(outbox, () =>
		flushOutbox(entryOutbox(outbox), createEntrySender(api, options)),
	);
}

export type SaveOutcome =
	/** The server has it; the token undoes it (null when it answered without one). */
	| { status: "synced"; undo: UndoRef | null }
	/** Waiting on this phone for a connection. */
	| { status: "queued" }
	/** The server refused it. It stays parked on the phone, never dropped. */
	| { status: "parked"; reason: string };

/** How long Save waits for the send before it lets the outbox carry on alone. */
const SAVE_WAIT_MS = SEND_TIMEOUT_MS + 2000;

export async function saveEntry(input: {
	outbox: Outbox;
	api: RetrospendClient;
	write: PendingWrite;
	/** Test seam: the wait for the send. */
	waitMs?: number;
}): Promise<SaveOutcome> {
	const { outbox, api, write } = input;
	const clientId = String(write.body.id);
	await outbox.enqueue({
		clientId,
		entity: write.entity,
		kind: "create",
		targetId: clientId,
		baseVersion: null,
		payload: write.body,
	});
	// The flush may be behind another one; Save does not wait on a slow
	// network, the entry stays in the outbox and goes when its turn comes.
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		flushEntries(outbox, api).catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, input.waitMs ?? SAVE_WAIT_MS);
		}),
	]);
	if (timer) clearTimeout(timer);
	// Whichever flush sent it, the token is kept under the client id.
	const undo = undoFor(clientId);
	if (undo) return { status: "synced", undo };
	const entry = (await outbox.all()).find((e) => e.clientId === clientId);
	// Gone from the outbox with no token: the server had it already.
	if (!entry) return { status: "synced", undo: null };
	return entry.state === "conflict"
		? { status: "parked", reason: entry.lastError ?? "refused" }
		: { status: "queued" };
}

export type UndoResult = "undone" | "failed";

/**
 * Takes a saved write back, and only after any send of it has ended.
 * - The server has it (a token is kept): the server's undo.
 * - It never left the phone (no send ever began): removed from the outbox.
 * - It may be on the server (a send began and its answer is missing): send it
 *   again with the same key, which replays the first answer and its token,
 *   then undo through the server. Never delete what the server may hold.
 * "failed" means it could not be taken back now (offline); it stays queued.
 */
export function undoSaved(input: {
	outbox: Outbox;
	api: RetrospendClient;
	clientId: string;
}): Promise<UndoResult> {
	const { outbox, api, clientId } = input;
	return exclusive(outbox, async () => {
		try {
			const known = undoFor(clientId);
			if (known) {
				await undoWrite(api, known, clientId);
				return "undone";
			}
			const entry = (await outbox.all()).find((e) => e.clientId === clientId);
			// Gone with no token: it was sent in an earlier session.
			if (!entry) return "failed";
			if (entry.attempts === 0) {
				await outbox.discard(clientId);
				return "undone";
			}
			await outbox.markSending(clientId);
			const sent = await createEntrySender(api)(entry);
			if (sent.status === "retry") {
				await outbox.markFailed(clientId, sent.reason, sent.kind);
				return "failed";
			}
			// Refused by the server: it never existed, so there is nothing to undo.
			if (sent.status === "conflict") {
				await outbox.discard(clientId);
				return "undone";
			}
			await outbox.markSent(clientId);
			const token = undoFor(clientId);
			// No token means the server held it already and answered without one.
			if (!token) return "failed";
			await undoWrite(api, token, clientId);
			return "undone";
		} catch {
			return "failed";
		}
	});
}
