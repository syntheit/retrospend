/**
 * The refusals on answering your own share, by the problem code the server
 * sends (shared-expenses/answer-guard.ts): never by the English message. Each
 * has its own sentence in `peoplePage.review.refused`, pointing to Ask to fix.
 */
const SHARE_REFUSALS = [
	"share_locked",
	"share_is_correction",
	"share_reject_reverses_payment",
] as const;

export type ShareRefusal = (typeof SHARE_REFUSALS)[number];

/** The refusal a failed Accept or Reject carries, or null for any other failure. */
export function shareRefusalOf(error: unknown): ShareRefusal | null {
	const problem = (error as { data?: { problem?: unknown } } | null)?.data
		?.problem;
	return SHARE_REFUSALS.find((code) => code === problem) ?? null;
}
