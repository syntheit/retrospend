import { ORPCError } from "@orpc/server";
import type { ProblemCode } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { MissingRateError } from "@retrospend/domain/money";
import { OverpayError } from "~/server/services/payments/procedures";
import { RateOutOfRangeError } from "~/server/services/payments/rate-band";
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

export function toProblem(error: unknown, route?: string): unknown {
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
	// More than everything owed: a code of its own, so a client can say so.
	if (error instanceof OverpayError) return problem("overpay", error.message);
	// A typed rate far from the stored one: a slip, with a code a client can show.
	if (error instanceof RateOutOfRangeError)
		return problem("rate_out_of_range", error.message);
	if (error instanceof TRPCError) {
		const code = TRPC_TO_PROBLEM[error.code];
		if (code) return problem(code, error.message);
		// tRPC wraps what a procedure throws; a known database error inside
		// (a taken client id) is answered as it would be from a service.
		if (error.cause instanceof Prisma.PrismaClientKnownRequestError)
			return toProblem(error.cause, route);
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
	// A row the caller named that is not theirs: their view of the table has no
	// such row, which is what the web shows as "not found" too.
	if (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === "P2025"
	) {
		// Expected for another user's id; worth a line when it is not. No user data in it.
		console.warn(
			`[api v1] ${route ?? "route"}: ${String(error.meta?.modelName ?? "a row")} not found, answered 404`,
		);
		return problem("not_found");
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

/** The route a handler runs for (`payments.record`), from oRPC's handler options. */
function routeOf(args: unknown[]): string | undefined {
	const path = (args[0] as { path?: readonly string[] } | undefined)?.path;
	return Array.isArray(path) ? path.join(".") : undefined;
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
			throw toProblem(error, routeOf(args));
		}
	};
}
