import { ORPCError } from "@orpc/server";
import type { ProblemCode } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { MissingRateError } from "~/lib/money";
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

/** Whether the unique key that failed is the row's id (its primary key). */
function idIsTheKey(error: Prisma.PrismaClientKnownRequestError): boolean {
	const meta = JSON.stringify(error.meta ?? {});
	return /"id"|_pkey/.test(meta);
}

export function toProblem(error: unknown): unknown {
	if (error instanceof ORPCError) return error;
	if (error instanceof InvalidCursorError)
		return problem("bad_request", error.message);
	// A conversion with no stored rate: the write is fine but cannot be booked
	// (a missing rate is never 1). Clients show "No rate yet" and offer a rate.
	const missing = [error, (error as { cause?: unknown } | null)?.cause].find(
		(e) => e instanceof MissingRateError,
	);
	if (missing instanceof MissingRateError)
		return problem("missing_rate", missing.message);
	if (error instanceof TRPCError) {
		const code = TRPC_TO_PROBLEM[error.code];
		if (code) return problem(code, error.message);
	}
	// A client-made id that is already taken: an earlier try of the same write
	// got through. Clients treat it as sent, so it has a code of its own.
	if (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === "P2002"
	) {
		return idIsTheKey(error)
			? problem("id_taken", "That id is already used")
			: problem("conflict", "That id or name is already used");
	}
	// A number past what its column holds (an amount whose USD value needs
	// more than 10 digits): the caller's input, not a server fault.
	if (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === "P2020"
	)
		return problem("validation_failed", "A number is too large to store", {
			errors: [{ path: "", message: "A number is too large to store" }],
		});
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
