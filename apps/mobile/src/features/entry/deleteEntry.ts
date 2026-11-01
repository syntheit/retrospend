import type { RetrospendClient } from "@retrospend/api-client";
import type { PreviewState } from "./preview";
import { SEND_TIMEOUT_MS, type UndoRef } from "./send";

// Deleting the expense an edit is open on: the server's dry run first (R30),
// then one write that ends in an Undo (R15). Your own expense gives back an
// undo token. A split expense changes what other people owe, so the server
// asks for a confirmation when the delete would erase a debt or leave the
// payer owing: its warning is shown, and only the Delete button confirms. Its
// undo brings back every share.

export type DeleteOutcome =
	/** `undo` is null when the server could not make a token for this delete. */
	| { status: "deleted"; undo: UndoRef | null }
	/** No answer: the phone is offline. Nothing was deleted. */
	| { status: "offline" }
	/** The server said no (payments cover it, or it is not yours to delete). */
	| { status: "refused" };

export interface DeleteTarget {
	id: string;
	/** A split expense: its own routes, and a warning to confirm. */
	shared: boolean;
}

/** The dry run, and the server's own warning when the delete needs a confirmation. */
export interface DeletePreview {
	state: PreviewState;
	/** What the server said before it would preview; the button then confirms. */
	warning: string | null;
	/**
	 * False when the server says this delete will give no Undo (a split someone
	 * else added, or one that voids payments), so the sheet says so before the tap.
	 */
	undoable: boolean;
}

/** The dry run's own flag; a plain expense or an older server can be undone. */
function undoableIn(diff: {
	detail?: { kind: string; undoable?: unknown };
}): boolean {
	return diff.detail?.undoable !== false;
}

function statusOf(error: unknown): { status?: number; message?: string } {
	return (error ?? {}) as { status?: number; message?: string };
}

/** What deleting would change, from the server's dry run of it. */
export async function previewDelete(
	api: RetrospendClient,
	target: DeleteTarget,
): Promise<DeletePreview> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	const { id } = target;
	try {
		if (!target.shared) {
			const diff = await api.expenses.previewDelete({ id }, options);
			return {
				state: { status: "ready", diff },
				warning: null,
				undoable: true,
			};
		}
		const shared = api["shared-expenses"];
		try {
			const diff = await shared.previewDelete({ id }, options);
			return {
				state: { status: "ready", diff },
				warning: null,
				undoable: undoableIn(diff),
			};
		} catch (error) {
			const { status, message } = statusOf(error);
			// The server's warning: shown as it is, and the dry run is asked again
			// as if confirmed so the sheet can say what changes. Nothing is deleted.
			if (status !== 409 || !message) throw error;
			const diff = await shared.previewDelete(
				{ id, confirmUnsettled: true },
				options,
			);
			return {
				state: { status: "ready", diff },
				warning: message,
				undoable: undoableIn(diff),
			};
		}
	} catch (error) {
		const { status } = statusOf(error);
		const state: PreviewState =
			status === undefined || status === 401
				? { status: "offline" }
				: { status: "refused", reason: "other", currency: "" };
		return { state, warning: null, undoable: true };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Deletes it. `idempotencyKey` belongs to this opening of the confirm: a
 * second tap after a lost answer replays the first delete. `confirmed` is true
 * only when the server's warning was on the sheet.
 */
export async function runDelete(
	api: RetrospendClient,
	target: DeleteTarget,
	idempotencyKey: string,
	confirmed = false,
): Promise<DeleteOutcome> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { context: { idempotencyKey }, signal: timeout.signal };
	const { id } = target;
	try {
		if (target.shared) {
			const result = await api["shared-expenses"].delete(
				confirmed ? { id, confirmUnsettled: true } : { id },
				options,
			);
			return {
				status: "deleted",
				undo: result.undo
					? { entity: "shared-expenses", token: result.undo }
					: null,
			};
		}
		const result = await api.expenses.delete({ id }, options);
		return {
			status: "deleted",
			undo: { entity: "expenses", token: result.undo },
		};
	} catch (error) {
		const { status } = statusOf(error);
		if (status === undefined || status === 401 || status === 408) {
			return { status: "offline" };
		}
		return { status: "refused" };
	} finally {
		clearTimeout(timer);
	}
}
