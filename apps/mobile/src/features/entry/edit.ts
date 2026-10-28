import type { RetrospendClient } from "@retrospend/api-client";
import { newClientId } from "@/data/ids";
import type { PendingWrite } from "./draft";
import { SEND_TIMEOUT_MS, type UndoRef } from "./send";

// Saving an edit of a saved expense. An edit is sent at once and never
// queued: it replaces a row the server holds, so it needs the server's answer
// (the dry run already showed what changes) and its undo token.

export type EditOutcome =
	/** The server took it; the token puts the old values back. */
	| { status: "saved"; undo: UndoRef }
	/** No answer: the phone is offline. Nothing was changed. */
	| { status: "offline" }
	/** The server read it and said no (a split, or money that moved in an account). */
	| { status: "refused" };

export async function saveExpenseEdit(
	api: RetrospendClient,
	write: PendingWrite,
): Promise<EditOutcome> {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	try {
		const options = {
			context: { idempotencyKey: newClientId() },
			signal: timeout.signal,
		};
		if (write.entity === "shared-expenses") {
			const result = await api["shared-expenses"].update(
				write.body as Parameters<(typeof api)["shared-expenses"]["update"]>[0],
				options,
			);
			return {
				status: "saved",
				undo: { entity: "shared-expenses", token: result.undo },
			};
		}
		const result = await api.expenses.update(
			write.body as Parameters<typeof api.expenses.update>[0],
			options,
		);
		return {
			status: "saved",
			undo: { entity: "expenses", token: result.undo },
		};
	} catch (error) {
		const { status } = (error ?? {}) as { status?: number };
		// No status: no answer. A 401 is the session ending; try again after.
		if (status === undefined || status === 401 || status === 408) {
			return { status: "offline" };
		}
		return { status: "refused" };
	} finally {
		clearTimeout(timer);
	}
}
