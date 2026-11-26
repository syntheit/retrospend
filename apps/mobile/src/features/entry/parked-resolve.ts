import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { deviceWrites } from "@/data/deviceWrites";
import type { Outbox, OutboxEntry } from "@/data/outbox";
import { originOf } from "@/data/outbox-chain";
import { type ParkedEntry, parkedFrom } from "./parked-entry";
import { exclusive } from "./queue";
import { typedAmountFits } from "./rebase";
import {
	forgetNotFound,
	MAYBE_GONE,
	notFoundPull,
	RECURRING_ALREADY_POSTED,
	RECURRING_CHANGED,
	recurringPayloadOf,
} from "./send";

/**
 * A parked 404 (or, over the vault, a 409) of an update or delete resolves on absence: a pull that began
 * after the answer and finished without the row shows another device deleted
 * it. A delete then has nothing left to do and leaves; an update stays as
 * "Deleted on another device". With the row still there, or no such pull yet,
 * it stays "Couldn't sync". A recurring confirm or skip reads the pulled
 * template instead (`resolveTemplate`).
 */
export async function resolveParked(
	outbox: Outbox,
	api: RetrospendClient,
	entry: OutboxEntry,
): Promise<ParkedEntry | null> {
	const writes = deviceWrites(api);
	if (
		!writes ||
		entry.kind === "create" ||
		!MAYBE_GONE.includes(entry.lastError ?? "")
	)
		return parkedFrom(entry);
	if (entry.entity === "recurring")
		return resolveTemplate(outbox, writes, entry);
	if (
		entry.entity !== "expenses" ||
		!(await writes.absentSince(entry.targetId, notFoundPull(entry.clientId)))
	)
		return parkedFrom(entry);
	if (entry.kind === "update") return parkedFrom(entry, true);
	// Gone already: retired without a Sync issue.
	await exclusive(outbox, () => outbox.discard(entry.clientId));
	forgetNotFound(entry.clientId);
	return null;
}

/** A parked write the person can only discard: the template moved under it, so sending it again could book the wrong period. */
const discardOnly = (entry: OutboxEntry, gone = false): ParkedEntry => ({
	...parkedFrom(entry, gone),
	retryable: false,
});

/**
 * A parked recurring confirm or skip, read from the template a pull left
 * after the answer. A pull that began before it, or none yet, resolves
 * nothing.
 * - Template gone: a poster entry or a skip has nothing left to do and
 *   leaves; a person's confirm shows "Deleted on another device".
 * - Its next due date is past the entry's `dueAt`, or it is paused: the
 *   period was posted, skipped or moved. A poster entry leaves (the next run
 *   plans from what is there). A person's confirm that was answered "already
 *   posted" leaves only if the pull shows the expense it named (its client
 *   id, whatever day a paid-on confirm booked it on); any other person's entry shows "Changed on another device", with
 *   Discard only. Nothing a person typed disappears without a word.
 * - Template still due and active, but a typed amount no longer fits it (the
 *   currency changed, or it stopped asking): "Changed on another device", with
 *   Discard only.
 * - Template still due and active: it stays parked, "Couldn't sync" (it came
 *   back, for example by Undo) or "Changed on another device", with Try again.
 *   An "already posted" answer with no such period is the exception above.
 */
async function resolveTemplate(
	outbox: Outbox,
	writes: DeviceWrites,
	entry: OutboxEntry,
): Promise<ParkedEntry | null> {
	const payload = recurringPayloadOf(entry);
	// An edit names no period: only whether the template is still there is read.
	const due = payload
		? new Date(payload.dueAt)
		: entry.kind === "update"
			? new Date(0)
			: null;
	const seen = due
		? await writes.templateSince(
				entry.targetId,
				notFoundPull(entry.clientId),
				due,
				entry.clientId,
			)
		: null;
	// Sending it again can only be answered "already posted" again.
	if (!seen)
		return entry.lastError === RECURRING_ALREADY_POSTED
			? discardOnly(entry)
			: parkedFrom(entry);
	const poster = originOf(entry) === "poster";
	const settledPeriod = seen.found && (seen.passed || seen.paused);
	const retire = !seen.found
		? poster || entry.kind === "skip"
		: poster
			? settledPeriod
			: entry.kind === "confirm" &&
				entry.lastError === RECURRING_ALREADY_POSTED &&
				seen.passed &&
				seen.posted;
	if (retire) {
		await exclusive(outbox, () => outbox.dropRetired(entry.clientId));
		forgetNotFound(entry.clientId);
		return null;
	}
	if (!seen.found) return discardOnly(entry, true);
	if (settledPeriod || entry.lastError === RECURRING_ALREADY_POSTED)
		return discardOnly(entry);
	// The amount was typed for a template that has since changed currency or
	// stopped asking: saving it again could book another amount.
	if (payload && !typedAmountFits(payload, seen))
		return { ...discardOnly(entry), reason: RECURRING_CHANGED };
	return parkedFrom(entry);
}
