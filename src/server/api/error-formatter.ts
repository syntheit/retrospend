import type { TRPCError } from "@trpc/server";
import { ZodError, z } from "zod";
import { isTextUnavailable } from "~/server/crypto/field-open";
import { RateOutOfRangeError } from "~/server/services/payments/rate-band";

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
	if (error instanceof RateOutOfRangeError) return "rate_out_of_range";
	if (isTextUnavailable(error)) return "encrypted_text_unavailable";
	return null;
}

export function errorFormatter<TShape extends { data: object }>({
	shape,
	error,
}: {
	shape: TShape;
	error: TRPCError;
}) {
	return {
		...shape,
		data: {
			...shape.data,
			zodError: zodErrorData(error),
			problem: problemCode(error),
		},
	};
}
