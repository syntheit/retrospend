/**
 * How hard a delivery is retried. Failed attempts wait 1, 2, 4, ... minutes
 * (doubling, capped at 6 hours) until MAX_ATTEMPTS, which spans about eight
 * and a half hours. A webhook that fails AUTO_DISABLE_AFTER attempts in a
 * row, across deliveries, is switched off until its owner turns it on.
 */
export const MAX_ATTEMPTS = 10;
export const AUTO_DISABLE_AFTER = 20;
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
