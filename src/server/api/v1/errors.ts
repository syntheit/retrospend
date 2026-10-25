import { ORPCError } from "@orpc/server";
import {
	PROBLEM_STATUS,
	type Problem,
	type ProblemCode,
	problemType,
} from "@retrospend/api-contract/common";

const TITLES: Record<ProblemCode, string> = {
	bad_request: "Bad request",
	validation_failed: "Validation failed",
	invalid_filter: "Invalid filter",
	idempotency_key_required: "Idempotency-Key required",
	unauthenticated: "Not signed in",
	forbidden: "Forbidden",
	missing_scope: "Missing scope",
	not_found: "Not found",
	conflict: "Conflict",
	payload_too_large: "Upload too large",
	idempotency_in_progress: "Request in progress",
	idempotency_replay_unavailable: "Response not stored",
	idempotency_key_reused: "Idempotency-Key reused",
	missing_rate: "No rate for that currency",
	overpay: "More than is owed",
	id_taken: "That id is already used",
	rate_limited: "Too many requests",
	internal: "Server error",
	not_implemented: "Not implemented",
};

/** oRPC's own codes (thrown by the framework) mapped to ours. */
const ORPC_CODES: Record<string, ProblemCode> = {
	BAD_REQUEST: "bad_request",
	UNAUTHORIZED: "unauthenticated",
	FORBIDDEN: "forbidden",
	NOT_FOUND: "not_found",
	CONFLICT: "conflict",
	TOO_MANY_REQUESTS: "rate_limited",
	NOT_IMPLEMENTED: "not_implemented",
};

type ProblemExtras = Pick<Problem, "requiredScope" | "retryAfter" | "errors">;

function isProblemCode(code: string): code is ProblemCode {
	return code in PROBLEM_STATUS;
}

/** Throw this from v1 code: an error that leaves as problem+json. */
export function problem(
	code: ProblemCode,
	detail?: string,
	extras: ProblemExtras = {},
) {
	return new ORPCError(code, {
		status: PROBLEM_STATUS[code],
		message: detail ?? TITLES[code],
		data: extras,
	});
}

type Issue = {
	path?: readonly (PropertyKey | { key: PropertyKey })[];
	message: string;
};

function issuesOf(cause: unknown): Issue[] | null {
	const issues = (cause as { issues?: unknown } | null)?.issues;
	return Array.isArray(issues) ? (issues as Issue[]) : null;
}

function issuePath(issue: Issue): string {
	return (issue.path ?? [])
		.map((p) => String(typeof p === "object" ? p.key : p))
		.join(".");
}

/**
 * The body of every v1 error response (RFC 9457). Our own problems carry
 * their code; framework errors are mapped, input validation lists the bad
 * fields, and anything unexpected is a bare `internal` so no stack or
 * message from inside the server leaks out.
 */
export function encodeProblem(error: ORPCError<string, unknown>): Problem {
	const issues = issuesOf(error.cause);
	let code: ProblemCode;
	if (isProblemCode(error.code)) code = error.code;
	else if (error.code === "BAD_REQUEST" && issues) code = "validation_failed";
	else code = ORPC_CODES[error.code] ?? "internal";

	const own = isProblemCode(error.code);
	const body: Problem = {
		type: problemType(code),
		title: TITLES[code],
		status: PROBLEM_STATUS[code],
		code,
	};
	if (own && error.message !== TITLES[code]) body.detail = error.message;
	if (own) Object.assign(body, error.data as ProblemExtras);
	if (code === "validation_failed" && issues) {
		body.errors = issues.map((i) => ({
			path: issuePath(i),
			message: i.message,
		}));
	}
	return body;
}
