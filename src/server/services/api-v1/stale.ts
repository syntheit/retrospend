import { TRPCError } from "@trpc/server";
import {
	EnvelopeError,
	type EnvelopeErrorCode,
} from "~/server/services/envelope/errors";

/**
 * What the envelope engine says when an undo no longer applies: it was
 * already taken back, a newer edit sits on top of it, or the state it needs
 * is gone ("there is no style change to undo"). A token's input is signed by
 * the server, so a refusal like this is the state having moved on: 409.
 * Missing rows stay 404 and a closed month or a cap stays 400 (the engine's
 * own validation), so a real error is never hidden.
 */
const STALE: ReadonlySet<EnvelopeErrorCode> = new Set([
	"ALREADY_UNDONE",
	"ID_REUSED",
	"INVALID",
	"BOOK_EXISTS",
]);

export async function staleAsConflict<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof EnvelopeError && STALE.has(error.code))
			throw new TRPCError({
				code: "CONFLICT",
				message: error.message,
				cause: error,
			});
		throw error;
	}
}
