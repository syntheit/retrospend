import type { TRPCError } from "@trpc/server";
import { ZodError, z } from "zod";
import { uniqueViolation } from "~/server/api/unique-violation";
import { ProtectedAccountError } from "~/server/api/protection/guard";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { RateOutOfRangeError } from "~/server/services/payments/rate-band";
import { ProtectedPasswordError } from "~/server/services/protection-keys/password-writes";
import { ShareAnswerRefusedError } from "~/server/services/shared-expenses/answer-guard";

/**
 * Field errors for input validation failures, in the flattened
 * `{ formErrors, fieldErrors }` shape the client reads from `data.zodError`.
 */
export function zodErrorData(error: TRPCError) {
	return error.cause instanceof ZodError ? z.flattenError(error.cause) : null;
}

/**
 * A refusal the web shows in its own words, by a code (the API v1 problem
 * code of the same name), not by the English message.
 */
export function problemCode(error: TRPCError) {
	if (error instanceof ProtectedAccountError) return "protected_account";
	if (error instanceof ProtectedPasswordError) return "protected_password";
	if (error instanceof RateOutOfRangeError) return "rate_out_of_range";
	if (error instanceof ShareAnswerRefusedError) return error.problem;
	if (error.code === "CONFLICT") {
		const taken = uniqueViolation(error.cause);
		if (taken) return taken.problem;
	}
	return textUnavailableProblem(error);
}

/** What a client reads when the server failed in a way it did not plan for. */
export const INTERNAL_MESSAGE = "Something went wrong";

/**
 * The line the server logs for an unexpected failure, with nothing the user
 * wrote in it: Prisma's and a plain error's message can carry values, so only
 * the error's name, the database's code and table, and the stack frames go.
 */
export function describeInternalError(
	path: string | undefined,
	error: TRPCError,
) {
	const cause = error.cause ?? error;
	const name = cause instanceof Error ? cause.name : typeof cause;
	const meta = cause as { code?: unknown; meta?: { modelName?: unknown } };
	const detail = [meta.code, meta.meta?.modelName]
		.filter((part): part is string => typeof part === "string")
		.join(" ");
	const frames =
		cause instanceof Error
			? (cause.stack ?? "")
					.split("\n")
					.filter((line) => line.trimStart().startsWith("at "))
					.slice(0, 8)
			: [];
	return [
		`[trpc] ${path ?? "unknown"} failed: ${name}${detail ? ` ${detail}` : ""}`,
		...frames,
	].join("\n");
}

export function errorFormatter<
	TShape extends { data: object; message: string },
>({ shape, error }: { shape: TShape; error: TRPCError }) {
	// Whatever the code did not plan for (a database error, a bug) is
	// INTERNAL_SERVER_ERROR, and its text is the library's own: file paths,
	// table and key names. Refusals the code throws on purpose carry other codes.
	const message =
		error.code === "INTERNAL_SERVER_ERROR" ? INTERNAL_MESSAGE : shape.message;
	// tRPC adds the server's stack to the shape outside production: file paths
	// and the original message. Nothing reads it, so it never leaves.
	const { stack: _stack, ...data } = shape.data as { stack?: unknown };
	return {
		...shape,
		message,
		data: {
			...(data as Omit<TShape["data"], "stack">),
			zodError: zodErrorData(error),
			problem: problemCode(error),
		},
	};
}
