/**
 * How hard a delivery is retried. Failed attempts wait 1, 2, 4, ... minutes
 * (doubling, capped at 6 hours) until MAX_ATTEMPTS, which spans about eight
 * and a half hours. Only deliveries that run out of attempts count against
 * the webhook: AUTO_DISABLE_AFTER of them in a row, with no success between,
 * switch it off until its owner turns it on. A receiver that is down for a
 * few minutes fails many first attempts but loses no delivery, so it stays on.
 */
export const MAX_ATTEMPTS = 10;
export const AUTO_DISABLE_AFTER = 5;
export const BASE_DELAY_MS = 60_000;
export const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** How long a claimed delivery stays claimed if its worker dies mid-attempt. */
export const CLAIM_LEASE_MS = 2 * ATTEMPT_TIMEOUT_MS + 30_000;
export const RETENTION_DAYS = 30;

/** The wait after the `attempt`-th failed attempt (1 for the first), or null when none is left. */
export function retryDelayMs(attempt: number): number | null {
	if (attempt >= MAX_ATTEMPTS) return null;
	return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}
