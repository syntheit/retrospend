import type { RetrospendClient } from "@retrospend/api-client";
import type { Outbox } from "@/data/outbox";
import { flushOutbox } from "@/data/sync";
import type { PendingWrite } from "./draft";
import {
	createEntrySender,
	entryOutbox,
	type UndoRef,
	undoWrite,
} from "./send";

// Save and Undo for the composers. Every write goes through the outbox first
// (the phone is offline-first), then one flush tries to send it: online it
// ends with the server's undo token, offline it waits in the outbox.

export type SaveOutcome =
	/** The server has it; the token undoes it. */
	| { status: "synced"; undo: UndoRef }
	/** Waiting on this phone for a connection. */
	| { status: "queued" }
	/** The server refused it. It stays parked on the phone, never dropped. */
	| { status: "parked"; reason: string };

export async function saveEntry(input: {
	outbox: Outbox;
	api: RetrospendClient;
	write: PendingWrite;
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
	const undos = new Map<string, UndoRef>();
	await flushOutbox(
		entryOutbox(outbox),
		createEntrySender(api, (entry, ref) => undos.set(entry.clientId, ref)),
	);
	const undo = undos.get(clientId);
	if (undo) return { status: "synced", undo };
	const entry = (await outbox.all()).find((e) => e.clientId === clientId);
	return entry?.state === "conflict"
		? { status: "parked", reason: entry.lastError ?? "refused" }
		: { status: "queued" };
}

/**
 * Takes a saved write back. A synced one goes through the server's undo; a
 * queued one is simply removed from the outbox before anything was sent.
 * "failed" means it could not be taken back (offline, or it went through
 * while the person tapped Undo); the toast says so.
 */
export async function undoSaved(input: {
	outbox: Outbox;
	api: RetrospendClient;
	clientId: string;
	outcome: SaveOutcome;
}): Promise<"undone" | "failed"> {
	const { outbox, api, clientId, outcome } = input;
	try {
		if (outcome.status === "synced") {
			await undoWrite(api, outcome.undo, clientId);
			return "undone";
		}
		if (outcome.status === "queued") {
			const waiting = (await outbox.pending()).some(
				(e) => e.clientId === clientId,
			);
			if (!waiting) return "failed";
			// markSent deletes the entry; for a retracted write that is the whole job.
			await outbox.markSent(clientId);
			return "undone";
		}
		return "failed";
	} catch {
		return "failed";
	}
}
