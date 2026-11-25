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
	// Password recovery with the recovery key (public routes under
	// /auth/recovery): the reset link is unknown, expired, used or admin-made;
	// the recovery proof is wrong; the account's keys have no recovery proof.
	invalid_token: 404,
	wrong_recovery_key: 400,
	recovery_unavailable: 409,
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
	// A category merge or delete the budget refuses (category-merge/refusals.ts).
	category_kind_mismatch: 409,
	category_closed_month: 409,
	category_income_rule: 409,
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
	// A money preview lost to a concurrent write twice in a row. It wrote
	// nothing; asking again gives the answer.
	preview_busy: 503,
	// An admin action whose cause is known (admin-failure.ts): the email server
	// refused or could not be reached, the sidecar's backup or rate sync did not
	// go through. Never carries the server's own error text.
	email_not_configured: 409,
	email_auth_failed: 502,
	email_unreachable: 502,
	email_timeout: 504,
	backup_running: 409,
	backup_unavailable: 502,
	backup_failed: 502,
	rate_sync_failed: 502,
	internal: 500,
	not_implemented: 501,
} as const satisfies Record<string, number>;

export type ProblemCode = keyof typeof PROBLEM_STATUS;

/** The admin action failures with a known cause, each with its own sentence on the web. */
export const ADMIN_FAILURE_CODES = [
	"email_not_configured",
	"email_auth_failed",
	"email_unreachable",
	"email_timeout",
	"backup_running",
	"backup_unavailable",
	"backup_failed",
	"rate_sync_failed",
] as const satisfies readonly ProblemCode[];

export type AdminFailureCode = (typeof ADMIN_FAILURE_CODES)[number];

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
 * protection routes) and `session_not_fresh` (sign in again). Recovery adds
 * `invalid_token` (the reset link is not usable), `wrong_recovery_key` and
 * `recovery_unavailable` (keys made before the recovery proof existed).
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
