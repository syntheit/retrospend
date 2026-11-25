/**
 * The one place a 429's wait is computed: whole seconds until the window
 * resets, rounded up and never below 1. A client that is told 0 retries at
 * once into another 429, so the last millisecond of a window still says 1.
 */
export function retryAfterSeconds(resetAtMs: number, nowMs: number): number {
	return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}
