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
	// The account has advanced protection on and the route has not been cleared
	// for it (protection/v1-allowed.ts; openapi.json marks each operation with
	// x-protected-account). Not a scope a token can gain.
	protected_account: 403,
	// The account's password is also its Advanced protection key set, so the
	// server cannot change or reset it alone (a client rotates it with the keys).
	protected_password: 403,
	// A change that needs a recent sign-in came on an older session (Advanced
	// protection turn-on: 10 minutes). The client asks the person to sign in again.
	session_not_fresh: 403,
	// Turning on Advanced protection only: the typed current password is wrong,
	// or the two-factor code is missing or wrong. Other routes keep bad_request.
	wrong_password: 400,
	two_factor_required: 400,
	wrong_two_factor_code: 400,
	not_found: 404,
	conflict: 409,
	// An expense write that named the updatedAt it last read, and the expense
	// changed since (another device edited it). Nothing was written; the client
	// reads the row again and decides.
	expense_changed: 409,
	// A vault write from an account that has no protection key set: nothing a
	// client sealed could ever be opened, so the server refuses to hold it.
	protection_keys_missing: 409,
	payload_too_large: 413,
	idempotency_in_progress: 409,
	idempotency_replay_unavailable: 409,
	idempotency_key_reused: 422,
	missing_rate: 422,
	overpay: 422,
	rate_out_of_range: 422,
	id_taken: 409,
	// An answer to your share that the expense's state refuses (see
	// shared-expenses/answer-guard.ts). Each points to Ask to fix instead.
	share_locked: 409,
	share_is_correction: 409,
	share_reject_reverses_payment: 409,
	// A sync cursor the log can no longer honor: another epoch, a position the
	// server has not reached, or one older than the kept tombstones. The client
	// drops that entity's rows and pulls again from the start.
	sync_reset_required: 410,
	rate_limited: 429,
	// A sealed text the reader may open, whose key the server cannot load
	// (key store lost or unreachable). Not a client fault; retrying later may work.
	encrypted_text_unavailable: 503,
	// A key was added since this server loaded its keys; it is loading them
	// again, and a retry of the same request opens the text.
	key_rotated: 503,
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
 * missing_scope, `retryAfter` (seconds) for rate_limited and `conflictIds` for
 * a vault write conflict. Advanced protection adds three 403 codes:
 * `protected_account` (the route is not cleared for the account),
 * `protected_password` (the password is changed with the keys, through the
 * protection routes) and `session_not_fresh` (sign in again).
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
		conflictIds: z.array(z.string()).max(500).optional().meta({
			description:
				"On a vault write conflict: the ids of the records whose base version is stale. Ids only; nothing was stored.",
		}),
	})
	.meta({ id: "Problem" });

export type Problem = z.infer<typeof problemSchema>;
