import { isSerializationFailure } from "~/server/db-contention";
import type { TransactionPurpose } from "./types";

/** What a person reads, in every transport, when a preview is busy. */
export const PREVIEW_BUSY_MESSAGE =
	"Something changed while this was loading. Try again.";

/**
 * A preview lost to a concurrent write twice in a row. It wrote nothing, so
 * the person can simply ask again; transports answer it as `preview_busy`,
 * never as an internal error.
 */
export class PreviewBusyError extends Error {
	constructor(options?: { cause?: unknown }) {
		super(PREVIEW_BUSY_MESSAGE, options);
		this.name = "PreviewBusyError";
	}
}

/**
 * Opens a transaction for `purpose` with `run`. The one place that decides
 * what is retried: a preview, never an apply (a write that lost the race
 * throws as it always did). Every preview runner calls it.
 */
export function runTransaction<T>(
	purpose: TransactionPurpose,
	run: () => Promise<T>,
): Promise<T> {
	return purpose === "preview" ? retryPreviewOnce(run) : run();
}

/**
 * Runs one preview transaction, and once more from a fresh transaction when
 * Postgres reports a serialization failure or deadlock (a preview runs at
 * REPEATABLE READ and its snapshot can miss a row another transaction
 * committed since). A preview commits nothing, so the retry cannot double a
 * write. A second failure throws `PreviewBusyError`. Any other error,
 * including the runner's rollback signal, passes through on the first try.
 */
async function retryPreviewOnce<T>(attempt: () => Promise<T>): Promise<T> {
	try {
		return await attempt();
	} catch (error) {
		if (!isSerializationFailure(error)) throw error;
	}
	try {
		return await attempt();
	} catch (error) {
		if (isSerializationFailure(error))
			throw new PreviewBusyError({ cause: error });
		throw error;
	}
}
