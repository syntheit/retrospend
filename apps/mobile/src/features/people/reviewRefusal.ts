/**
 * Why the server refused to even preview an answer: the expense is settled,
 * is a correction, or the share is paid. Each has a sentence that points to
 * Ask to fix; any other failure stays the generic "couldn't check".
 */
export const REVIEW_REFUSALS = [
	"share_locked",
	"share_is_correction",
	"share_reject_reverses_payment",
] as const;
export type ReviewRefusal = (typeof REVIEW_REFUSALS)[number];

export function refusalOf(error: unknown): ReviewRefusal | null {
	const code = (error as { code?: unknown } | null)?.code;
	return REVIEW_REFUSALS.find((r) => r === code) ?? null;
}
