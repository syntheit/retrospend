import type { Outbox, OutboxEntry } from "./outbox";
import { isUnresolved, PARKED_CHAIN_LOST } from "./outbox-chain";

// The sync seam. The engine sends outbox entries in order through a `send`
// function the screens provide (a v1 call for that entity). Full sync (delta
// pulls with tombstones, conflict resolution UI) builds on this later.

export type SendResult =
	/**
	 * `version` is the row's `updatedAt` from the answer (null for a delete);
	 * it is written into the entries chained after this one.
	 */
	| { status: "sent"; version?: string | null }
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

export type Sender = (entry: OutboxEntry) => Promise<SendResult>;

export interface FlushReport {
	sent: number;
	conflicts: number;
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
 * row; an unsent one does too, until it is sent or parked.
 */
function nextToSend(entries: readonly OutboxEntry[]): OutboxEntry | undefined {
	return entries.find(
		(e, i) =>
			e.state !== "conflict" &&
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
	const report: FlushReport = { sent: 0, conflicts: 0, stopped: false };
	for (;;) {
		const entry = nextToSend(await outbox.all());
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
