import type { Outbox, OutboxEntry } from "./outbox";

// The sync seam. The engine sends outbox entries in order through a `send`
// function the screens provide (a v1 call for that entity). Full sync (delta
// pulls with tombstones, conflict resolution UI) builds on this later.

export type SendResult =
	| { status: "sent" }
	/** The server holds a newer version of the row. Parked, not retried. */
	| { status: "conflict"; reason: string }
	/** No network or a server error: keep the entry and stop, to keep order. */
	| { status: "retry"; reason: string };

export type Sender = (entry: OutboxEntry) => Promise<SendResult>;

export interface FlushReport {
	sent: number;
	conflicts: number;
	/** True when a retryable failure stopped the run. */
	stopped: boolean;
}

export async function flushOutbox(
	outbox: Outbox,
	send: Sender,
): Promise<FlushReport> {
	const report: FlushReport = { sent: 0, conflicts: 0, stopped: false };
	for (const entry of await outbox.pending()) {
		let result: SendResult;
		try {
			result = await send(entry);
		} catch (error) {
			result = { status: "retry", reason: String(error) };
		}
		if (result.status === "sent") {
			await outbox.markSent(entry.clientId);
			report.sent += 1;
		} else if (result.status === "conflict") {
			await outbox.markConflict(entry.clientId, result.reason);
			report.conflicts += 1;
		} else {
			await outbox.markFailed(entry.clientId, result.reason);
			report.stopped = true;
			return report;
		}
	}
	return report;
}
