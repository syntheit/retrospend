import type { Outbox, OutboxEntry } from "./outbox";
import { isUnresolved, PARKED_CHAIN_LOST } from "./outbox-chain";

// The sync seam. The engine sends outbox entries in order through a `send`
// function the screens provide (a v1 call for that entity). Full sync (delta
// pulls with tombstones, conflict resolution UI) builds on this later.

export type SendResult =
	/**
	 * `version` is the row's `updatedAt` from the answer (null for a delete);
	 * it is written into the entries chained after this one. For a recurring
	 * confirm or skip it is the answer's `templateUpdatedAt` (see `templateAck`).
	 */
	| { status: "sent"; version?: string | null }
	/**
	 * Nothing to send any more: the server already has the write, or the row
	 * moved under a poster's plan. It leaves with no ack and no Sync issue.
	 */
	| { status: "retired" }
	/**
	 * Not yet (a recurring period that is not due). The entry stays pending, and
	 * for the rest of this run it and the later entries for its row are held;
	 * other rows go on. Never parked, never counted as a failure.
	 */
	| { status: "later" }
	/**
	 * The server refused it, or holds a newer version. Parked, not retried.
	 * `http` is the status it answered with, when it answered.
	 */
	| { status: "conflict"; reason: string; http?: number }
	/**
	 * No network or a server error: keep the entry and stop, to keep order.
	 * `kind` says which; without it the try counts as a network failure.
	 */
	| { status: "retry"; reason: string; kind?: "network" | "server" };

/**
 * The recurring confirm and skip answers' stamp after the write, as contract
 * 1.10.0 (PR4) adds it. The contract does not have it on this branch yet, so
 * the shape is typed here to match: a timestamp string, `templateUpdatedAt`.
 */
export interface TemplateAnswer {
	templateUpdatedAt: string;
}

/** A confirm or skip the server took: the next entry for the template takes this stamp. */
export const templateAck = (answer: TemplateAnswer): SendResult => ({
	status: "sent",
	version: answer.templateUpdatedAt,
});

export type Sender = (entry: OutboxEntry) => Promise<SendResult>;

export interface FlushReport {
	sent: number;
	conflicts: number;
	/** Entries that left without an ack (see `retired` in SendResult). */
	retired: number;
	/** Entries answered "not yet" this run. */
	later: number;
	/** True when a retryable failure stopped the run. */
	stopped: boolean;
}

export interface FlushOptions {
	/**
	 * `DeviceEngine.pullsBegun`, read as each answer arrives. Required wherever
	 * an engine exists: without it an acked device write is never retired by a
	 * pull of this run (see Ack.pull).
	 */
	pullsBegun?: () => number;
}

/**
 * The next entry to send: the first that is not parked and has no earlier
 * entry for the same row. A parked entry holds everything behind it for its
 * row; an unsent one does too, until it is sent or parked. `held` names the
 * rows answered "not yet" in this run: nothing for them is sent again.
 */
function nextToSend(
	entries: readonly OutboxEntry[],
	held: ReadonlySet<string>,
): OutboxEntry | undefined {
	return entries.find(
		(e, i) =>
			e.state !== "conflict" &&
			!held.has(e.targetId) &&
			!entries.slice(0, i).some((before) => before.targetId === e.targetId),
	);
}

/**
 * Sends the entries in order. Before each send it reads the list again (not
 * once up front): the ack just before may have written a version into the
 * next entry, and the one sent must carry it. Reads `all()`, because
 * `pending()` hides the parked entries the hold rule needs.
 */
export async function flushOutbox(
	outbox: Outbox,
	send: Sender,
	options: FlushOptions = {},
): Promise<FlushReport> {
	const report: FlushReport = {
		sent: 0,
		conflicts: 0,
		retired: 0,
		later: 0,
		stopped: false,
	};
	// Rows answered "not yet": held for this run only, never stored.
	const held = new Set<string>();
	for (;;) {
		const entry = nextToSend(await outbox.all(), held);
		if (!entry) return report;
		// Nothing earlier for its row is left, so a stamp still naming an entry
		// belongs to one that ended without an ack: never sent with it.
		if (isUnresolved(entry.baseVersion)) {
			await outbox.markConflict(entry.clientId, PARKED_CHAIN_LOST);
			report.conflicts += 1;
			continue;
		}
		let result: SendResult;
		await outbox.markSending(entry.clientId);
		try {
			result = await send(entry);
		} catch (error) {
			result = { status: "retry", reason: String(error) };
		}
		if (result.status === "sent") {
			await outbox.markSent(entry.clientId, {
				version: result.version,
				pull: options.pullsBegun?.(),
			});
			report.sent += 1;
		} else if (result.status === "retired") {
			await outbox.dropRetired(entry.clientId);
			report.retired += 1;
		} else if (result.status === "later") {
			await outbox.markLater(entry.clientId);
			held.add(entry.targetId);
			report.later += 1;
		} else if (result.status === "conflict") {
			await outbox.markConflict(entry.clientId, result.reason);
			report.conflicts += 1;
		} else {
			await outbox.markFailed(entry.clientId, result.reason, result.kind);
			report.stopped = true;
			return report;
		}
	}
}
