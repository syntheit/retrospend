import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { isFlagEnabled } from "~/server/flags";
import {
	EnvelopeError,
	type EnvelopeErrorCode,
} from "~/server/services/envelope/errors";
import type { Caller } from "../caller";

/** Every budget route needs the time zone the middleware resolved. */
export type BudgetCaller = Caller & { timeZone: string };

const CODES: Record<EnvelopeErrorCode, TRPC_ERROR_CODE_KEY> = {
	NO_BOOK: "NOT_FOUND",
	BOOK_EXISTS: "CONFLICT",
	MONTH_CLOSED: "BAD_REQUEST",
	OVER_CAP: "BAD_REQUEST",
	INVALID: "BAD_REQUEST",
	NOT_FOUND: "NOT_FOUND",
	ID_REUSED: "CONFLICT",
	ALREADY_UNDONE: "CONFLICT",
};

/** Engine errors leave as the codes the web maps them to (envelope-procedure.ts). */
export async function withEnvelopeErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof EnvelopeError)
			throw new TRPCError({
				code: CODES[error.code],
				message: error.message,
				cause: error,
			});
		throw error;
	}
}

/** The budget sits behind the same flag as on the web. */
export async function assertBudgetOn(caller: Caller) {
	if (!(await isFlagEnabled("envelopeBudget", { role: caller.principal.role })))
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The new budget is not available yet",
		});
}
