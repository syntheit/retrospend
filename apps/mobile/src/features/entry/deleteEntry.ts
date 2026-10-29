import type { RetrospendClient } from "@retrospend/api-client";
import type { PreviewState } from "./preview";
import { SEND_TIMEOUT_MS, type UndoRef } from "./send";

// Deleting the expense an edit is open on: the server's dry run first (R30),
// then one write that ends in an Undo (R15). Only your own expense can be
// deleted here: it gives back an undo token. A split expense has none and
// changes what other people owe, so the composer leaves its delete out.

export type DeleteOutcome =
	| { status: "deleted"; undo: UndoRef }
	/** No answer: the phone is offline. Nothing was deleted. */
	| { status: "offline" }
	/** The server said no (payments cover it, or it is not yours to delete). */
	| { status: "refused" };

/** What deleting would change, from the server's dry run of it. */
export async function previewDelete(
	api: RetrospendClient,
	id: string,
): Promise<PreviewState> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const diff = await api.expenses.previewDelete({ id }, options);
		return { status: "ready", diff };
	} catch (error) {
		const { status } = (error ?? {}) as { status?: number };
		if (status === undefined || status === 401) return { status: "offline" };
		return { status: "refused", reason: "other", currency: "" };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Deletes it. `idempotencyKey` belongs to this opening of the confirm: a
 * second tap after a lost answer replays the first delete.
 */
export async function runDelete(
	api: RetrospendClient,
	id: string,
	idempotencyKey: string,
): Promise<DeleteOutcome> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { context: { idempotencyKey }, signal: timeout.signal };
	try {
		const result = await api.expenses.delete({ id }, options);
		return {
			status: "deleted",
			undo: { entity: "expenses", token: result.undo },
		};
	} catch (error) {
		const { status } = (error ?? {}) as { status?: number };
		if (status === undefined || status === 401 || status === 408) {
			return { status: "offline" };
		}
		return { status: "refused" };
	} finally {
		clearTimeout(timer);
	}
}
