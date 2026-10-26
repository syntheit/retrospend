/**
 * How hard a push is retried. A push is only useful soon, so the waits are
 * short: 30 seconds, doubling, capped at 30 minutes, for up to MAX_ATTEMPTS
 * (about two hours in all). A push still pending after PUSH_TTL_SECONDS (see
 * message.ts) is dropped without a send: the push service would have
 * dropped it too.
 */
export const MAX_ATTEMPTS = 8;
export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 30 * 60 * 1000;
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** How long a claimed delivery stays claimed if its worker dies mid-attempt. */
export const CLAIM_LEASE_MS = 3 * ATTEMPT_TIMEOUT_MS + 30_000;
/** Finished deliveries are kept this long for debugging, then deleted. */
export const RETENTION_DAYS = 7;

/** The wait after the `attempt`-th failed attempt (1 for the first), or null when none is left. */
export function retryDelayMs(attempt: number, hintMs?: number): number | null {
	if (attempt >= MAX_ATTEMPTS) return null;
	const own = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
	// A push service that says when to come back is believed, within the cap.
	return Math.min(Math.max(own, hintMs ?? 0), MAX_DELAY_MS);
}
