import type { TRPCError } from "@trpc/server";
import { ZodError, z } from "zod";

/**
 * Field errors for input validation failures, in the flattened
 * `{ formErrors, fieldErrors }` shape the client reads from `data.zodError`.
 */
export function zodErrorData(error: TRPCError) {
	return error.cause instanceof ZodError ? z.flattenError(error.cause) : null;
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
		},
	};
}
