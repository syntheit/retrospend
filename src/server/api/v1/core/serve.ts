import { ORPCError } from "@orpc/server";
import type { ProblemCode } from "@retrospend/api-contract/common";
import { CategoryMergeRefusal } from "@retrospend/domain/category-merge/refusals";
import {
	AmountRefusedError,
	CategoryNotFoundError,
	EditRefusal,
} from "@retrospend/domain/expense-write/refusals";
import { MissingRateError } from "@retrospend/domain/money";
import {
	RecurringRefusal,
	type RecurringRefusalKind,
} from "@retrospend/domain/recurring-post/refusals";
import { TRPCError } from "@trpc/server";
import { uniqueViolation } from "~/server/api/unique-violation";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { AdminFailureError } from "~/server/services/admin-failure";
import { InvalidCursorError } from "~/server/services/api-v1/cursor";
import { InvalidResetTokenError } from "~/server/services/auth/reset-tokens";
import { OverpayError } from "~/server/services/payments/procedures";
import { RateOutOfRangeError } from "~/server/services/payments/rate-band";
import { PreviewBusyError } from "~/server/services/preview/busy";
import {
	EnableProtectionError,
	ProtectionKeysError,
	ReleaseError,
	RotatePasswordError,
} from "~/server/services/protection-keys/errors";
import { ProtectedPasswordError } from "~/server/services/protection-keys/password-writes";
import { ShareAnswerRefusedError } from "~/server/services/shared-expenses/answer-guard";
import { SyncResetRequiredError } from "~/server/services/sync/changes";
import { VaultError } from "~/server/services/vault/errors";
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

const ENABLE_DETAIL: Record<EnableProtectionError["code"], string> = {
	session_not_fresh: "Sign in again to turn on Advanced protection",
	email_not_verified: "Verify your email first",
	no_password: "Advanced protection needs an account with a password",
	wrong_password: "Current password is incorrect",
	two_factor_required: "Enter your two-factor code",
	wrong_two_factor_code: "That two-factor code is not right",
};

function enableProblem(error: EnableProtectionError) {
	const detail = ENABLE_DETAIL[error.code];
	if (error.code === "email_not_verified") return problem("forbidden", detail);
	if (error.code === "no_password") return problem("bad_request", detail);
	// The rest are problem codes of the same name.
	return problem(error.code, detail);
}

function rotateProblem(error: RotatePasswordError) {
	if (error.code === "no_password")
		return problem(
			"bad_request",
			"Password change is not available for this account",
		);
	return problem("wrong_password", "Current password is incorrect");
}

function releaseProblem(error: ReleaseError) {
	if (error.code === "no_keys")
		return problem("not_found", "You have no protection keys");
	if (error.code === "no_password")
		return problem("bad_request", "This account has no password");
	if (error.code === "changed")
		return problem("conflict", "The password changed. Try again.");
	if (error.code === "recovery_unavailable")
		return problem(
			"recovery_unavailable",
			"This account has no recovery key set up",
		);
	return problem("wrong_password", "Current password is incorrect");
}

function vaultProblem(error: VaultError) {
	if (error.code === "conflict")
		return problem("conflict", error.message, {
			conflictIds: [...error.ids],
		});
	if (error.code === "keys_missing")
		return problem("protection_keys_missing", error.message);
	return problem("bad_request", error.message);
}

const RECURRING_PROBLEM = {
	not_found: "not_found",
	already_posted: "recurring_already_posted",
	not_due: "recurring_not_due",
} as const satisfies Record<RecurringRefusalKind, ProblemCode>;

export function toProblem(error: unknown, route?: string): unknown {
	if (error instanceof ORPCError) return error;
	if (error instanceof InvalidCursorError)
		return problem("bad_request", error.message);
	// A sync cursor from another epoch or older than the kept tombstones: the
	// client drops that entity's rows and pulls again from the start.
	if (error instanceof SyncResetRequiredError)
		return problem("sync_reset_required", error.message);
	// A conversion with no stored rate: the write is fine but cannot be booked
	// (a missing rate is never 1). Clients show "No rate yet" and offer a rate.
	const missing = [error, (error as { cause?: unknown } | null)?.cause].find(
		(e) => e instanceof MissingRateError,
	);
	if (missing instanceof MissingRateError)
		return problem("missing_rate", missing.message);
	// The expense write rules' refusals: a bad category answers with the code
	// of the route that threw it (404 on a write, 403 on categorize).
	const refused = [error, (error as { cause?: unknown } | null)?.cause].find(
		(e) =>
			e instanceof CategoryNotFoundError ||
			e instanceof AmountRefusedError ||
			e instanceof EditRefusal,
	);
	if (refused instanceof EditRefusal)
		return problem(
			refused.kind === "notFound" ? "not_found" : "bad_request",
			refused.message,
		);
	if (refused instanceof CategoryNotFoundError)
		return problem(refused.v1Code, refused.message);
	if (refused instanceof AmountRefusedError)
		return problem("bad_request", refused.message);
	// Confirming or skipping a recurring period: a code per refusal, so a client
	// that queued the write can tell a period already posted (drop it) from one
	// not due yet (wait).
	const recurring = [error, (error as { cause?: unknown } | null)?.cause].find(
		(e) => e instanceof RecurringRefusal,
	);
	if (recurring instanceof RecurringRefusal)
		return problem(RECURRING_PROBLEM[recurring.kind], recurring.message);
	// A preview that lost to a concurrent write twice: nothing was written.
	if (
		[error, (error as { cause?: unknown } | null)?.cause].some(
			(e) => e instanceof PreviewBusyError,
		)
	)
		return problem("preview_busy");
	// A sealed text the caller may read whose key the server cannot load: the
	// key store is lost or unreachable. The recorded code stays in the log.
	const unavailable = textUnavailableProblem(error);
	if (unavailable) return problem(unavailable);
	// More than everything owed: a code of its own, so a client can say so.
	if (error instanceof OverpayError) return problem("overpay", error.message);
	// A typed rate far from the stored one: a slip, with a code a client can show.
	if (error instanceof RateOutOfRangeError)
		return problem("rate_out_of_range", error.message);
	// An answer the expense's state refuses: a code per reason, each pointing
	// to Ask to fix, so a client words it.
	if (error instanceof ShareAnswerRefusedError)
		return problem(error.problem, error.message);
	const merge = [error, (error as { cause?: unknown } | null)?.cause].find(
		(e) => e instanceof CategoryMergeRefusal,
	);
	if (merge instanceof CategoryMergeRefusal)
		return problem(merge.problem, merge.message);
	// An admin action whose cause is known (mail server, backup, rate sync):
	// a code per cause, with the fixed sentence and never the upstream's text.
	if (error instanceof AdminFailureError)
		return problem(error.problem, error.message);
	// The password is the account's key wrap: only a client can change it.
	if (error instanceof ProtectedPasswordError)
		return problem("protected_password", error.message);
	// Turning on Advanced protection: a stale session has a code of its own so
	// the client asks for a new sign-in; the rest are the person's input.
	if (error instanceof EnableProtectionError) return enableProblem(error);
	if (error instanceof RotatePasswordError) return rotateProblem(error);
	if (error instanceof ReleaseError) return releaseProblem(error);
	// A reset link that is unknown, expired, spent or admin-made: one answer.
	if (error instanceof InvalidResetTokenError) return problem("invalid_token");
	if (error instanceof ProtectionKeysError)
		return error.code === "conflict"
			? problem("conflict", error.message)
			: problem("bad_request", error.message);
	// The sealed record store: a stale base lists the ids and nothing was
	// stored; a batch with no key set to open it is refused.
	if (error instanceof VaultError) return vaultProblem(error);
	if (error instanceof TRPCError) {
		// The tRPC middleware answers a unique violation as CONFLICT; v1 keeps
		// the finer code (a taken id) from the database error it carries.
		if (uniqueViolation(error.cause)) return toProblem(error.cause, route);
		const code = TRPC_TO_PROBLEM[error.code];
		if (code) return problem(code, error.message);
		// tRPC wraps what a procedure throws; a known database error inside
		// (a taken client id) is answered as it would be from a service.
		if (error.cause instanceof Prisma.PrismaClientKnownRequestError)
			return toProblem(error.cause, route);
	}
	// A client-made id that is already taken: an earlier try of the same write
	// got through. Clients treat it as sent, so it has a code of its own.
	const taken = uniqueViolation(error);
	if (taken) return problem(taken.problem, taken.message);
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
