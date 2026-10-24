import { ORPCError } from "@orpc/server";
import type { ProblemCode } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { InvalidCursorError } from "~/server/services/api-v1/cursor";
import { Prisma } from "~prisma";
import { problem } from "../errors";

/**
 * The domain services both transports share throw TRPCError, as they did
 * before v1 existed. These are the codes they use, as problem codes; any
 * other failure stays a bare `internal` (encodeProblem hides its message).
 */
const TRPC_TO_PROBLEM: Partial<Record<TRPCError["code"], ProblemCode>> = {
	BAD_REQUEST: "bad_request",
	NOT_FOUND: "not_found",
	CONFLICT: "conflict",
	FORBIDDEN: "forbidden",
	PRECONDITION_FAILED: "conflict",
	UNAUTHORIZED: "unauthenticated",
	// Services use it for cooldowns (one username change per 30 days), not
	// request rates: a 429 would invite a retry that cannot succeed.
	TOO_MANY_REQUESTS: "conflict",
	// The server lacks a part this needs (rate sync without its sidecar).
	NOT_IMPLEMENTED: "not_implemented",
};

export function toProblem(error: unknown): unknown {
	if (error instanceof ORPCError) return error;
	if (error instanceof InvalidCursorError)
		return problem("bad_request", error.message);
	if (error instanceof TRPCError) {
		const code = TRPC_TO_PROBLEM[error.code];
		if (code) return problem(code, error.message);
	}
	// A client-made id (or another unique key) that is already taken.
	if (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === "P2002"
	)
		return problem("conflict", "That id or name is already used");
	return error;
}

/**
 * Wraps a v1 handler so a service error leaves as its problem+json. Use on
 * every G1 handler: `v1.x.y.handler(serve(async ({ context, input }) => ...))`.
 */
export function serve<A extends unknown[], R>(
	fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	return async (...args) => {
		try {
			return await fn(...args);
		} catch (error) {
			throw toProblem(error);
		}
	};
}
