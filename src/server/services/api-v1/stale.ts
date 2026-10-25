import { TRPCError } from "@trpc/server";
import { EnvelopeError } from "~/server/services/envelope/errors";

/**
 * A token that can no longer apply means the state moved on since the write:
 * that is a conflict (409), whatever the engine called it.
 */
export async function staleAsConflict<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		const stale =
			error instanceof EnvelopeError ||
			(error instanceof TRPCError &&
				(error.code === "BAD_REQUEST" || error.code === "NOT_FOUND"));
		if (stale)
			throw new TRPCError({
				code: "CONFLICT",
				message: error.message,
				cause: error,
			});
		throw error;
	}
}
