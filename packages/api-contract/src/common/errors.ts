import * as z from "zod";

/**
 * Stable error codes. Clients branch on `code`, never on `title` or
 * `detail`, so a code is never renamed or reused; retire one by leaving it
 * here unused. Each maps to exactly one HTTP status.
 */
export const PROBLEM_STATUS = {
	bad_request: 400,
	validation_failed: 400,
	invalid_filter: 400,
	idempotency_key_required: 400,
	unauthenticated: 401,
	forbidden: 403,
	missing_scope: 403,
	not_found: 404,
	conflict: 409,
	payload_too_large: 413,
	idempotency_in_progress: 409,
	idempotency_replay_unavailable: 409,
	idempotency_key_reused: 422,
	missing_rate: 422,
	id_taken: 409,
	rate_limited: 429,
	internal: 500,
	not_implemented: 501,
} as const satisfies Record<string, number>;

export type ProblemCode = keyof typeof PROBLEM_STATUS;

export const PROBLEM_CODES = Object.keys(PROBLEM_STATUS) as ProblemCode[];

/** Media type of every error response (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * The `type` URI for a code. A URN, not a URL: self-hosted servers have no
 * shared docs host, and RFC 9457 only needs a stable identifier.
 */
export function problemType(code: ProblemCode): string {
	return `urn:retrospend:problem:${code}`;
}

export const problemIssueSchema = z.object({
	path: z.string().meta({ description: "Dotted path of the bad field." }),
	message: z.string(),
});

/**
 * RFC 9457 problem details plus the extension members we use: the stable
 * `code`, field `errors` for validation failures, `requiredScope` for
 * missing_scope and `retryAfter` (seconds) for rate_limited.
 */
export const problemSchema = z
	.object({
		type: z.string(),
		title: z.string(),
		status: z.int(),
		code: z.enum(PROBLEM_CODES as [ProblemCode, ...ProblemCode[]]),
		detail: z.string().optional(),
		instance: z.string().optional(),
		errors: z.array(problemIssueSchema).optional(),
		requiredScope: z.string().optional(),
		retryAfter: z.int().optional(),
	})
	.meta({ id: "Problem" });

export type Problem = z.infer<typeof problemSchema>;
