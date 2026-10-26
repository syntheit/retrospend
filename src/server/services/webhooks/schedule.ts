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

/**
 * How much of a sending worker one person, or one place, may use. A webhook
 * URL (and a UnifiedPush endpoint, see push/schedule.ts) is an address a
 * user chose, so it can be one that answers after the full timeout every
 * time. Without these caps a few such addresses, each retried, hold every
 * slot for minutes and nobody else's delivery goes out.
 * - at most PARALLEL_ATTEMPTS sends at once, PER_USER_ATTEMPTS of them for
 *   one account and PER_HOST_ATTEMPTS to one host name, whoever owns the
 *   addresses (one account's many names are held by its own cap);
 * - a sweep takes at most PER_USER_BATCH due deliveries per account, oldest
 *   first and interleaved, so a backlog cannot push others out of the batch;
 * - a sweep keeps pulling more due work while slots are free, and stops
 *   starting attempts after SWEEP_BUDGET_MS (worker.ts), so one account's
 *   black-hole URLs cost everyone else seconds, not minutes.
 */
export const PARALLEL_ATTEMPTS = 5;
export const PER_USER_ATTEMPTS = 2;
export const PER_HOST_ATTEMPTS = 2;
export const PER_USER_BATCH = 10;

/** The wait after the `attempt`-th failed attempt (1 for the first), or null when none is left. */
export function retryDelayMs(attempt: number): number | null {
	if (attempt >= MAX_ATTEMPTS) return null;
	return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}
