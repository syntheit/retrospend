import type { RetrospendClient } from "@retrospend/api-client";
import type { PreviewState } from "./preview";
import { SEND_TIMEOUT_MS, type UndoRef } from "./send";

// Deleting the expense an edit is open on: the server's dry run first (R30),
// then one write that ends in an Undo (R15). A personal expense gives back an
// undo token. A split has none, so its delete is confirmed instead: it changes
// what other people owe.

export type DeleteKind = "expense" | "shared";

export type DeleteOutcome =
	| { status: "deleted"; undo: UndoRef | null }
	/** No answer: the phone is offline. Nothing was deleted. */
	| { status: "offline" }
	/** The server said no (payments cover it, or it is not yours to delete). */
	| { status: "refused" };

/** What deleting would change, from the server's dry run of it. */
export async function previewDelete(
	api: RetrospendClient,
	kind: DeleteKind,
	id: string,
): Promise<PreviewState> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const diff =
			kind === "expense"
				? await api.expenses.previewDelete({ id }, options)
				: await api["shared-expenses"].previewDelete(
						{ id, confirmUnsettled: true },
						options,
					);
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
	kind: DeleteKind,
	id: string,
	idempotencyKey: string,
): Promise<DeleteOutcome> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { context: { idempotencyKey }, signal: timeout.signal };
	try {
		if (kind === "expense") {
			const result = await api.expenses.delete({ id }, options);
			return {
				status: "deleted",
				undo: { entity: "expenses", token: result.undo },
			};
		}
		await api["shared-expenses"].delete(
			{ id, confirmUnsettled: true },
			options,
		);
		return { status: "deleted", undo: null };
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
