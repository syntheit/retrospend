import type { RetrospendClient } from "@retrospend/api-client";
import { deviceWrites } from "@/data/deviceWrites";
import type { Outbox, OutboxEntry } from "@/data/outbox";
import { type ParkedEntry, parkedFrom } from "./parked-entry";
import { exclusive } from "./queue";
import { forgetNotFound, notFoundPull, PARKED_NOT_FOUND } from "./send";

/**
 * A parked 404 of an update or delete resolves on absence: a pull that began
 * after the answer and finished without the row shows another device deleted
 * it. A delete then has nothing left to do and leaves; an update stays as
 * "Deleted on another device". With the row still there, or no such pull yet,
 * it stays "Couldn't sync".
 */
export async function resolveParked(
	outbox: Outbox,
	api: RetrospendClient,
	entry: OutboxEntry,
): Promise<ParkedEntry | null> {
	const writes = deviceWrites(api);
	if (
		!writes ||
		entry.entity !== "expenses" ||
		entry.kind === "create" ||
		entry.lastError !== PARKED_NOT_FOUND ||
		!(await writes.absentSince(entry.targetId, notFoundPull(entry.clientId)))
	)
		return parkedFrom(entry);
	if (entry.kind === "update") return parkedFrom(entry, true);
	// Gone already: retired without a Sync issue.
	await exclusive(outbox, () => outbox.discard(entry.clientId));
	forgetNotFound(entry.clientId);
	return null;
}
