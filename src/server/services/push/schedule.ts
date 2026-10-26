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

/**
 * How much of the worker one person, or one place, may use. A UnifiedPush
 * endpoint is an address a user chose, so it can be one that answers after
 * the full timeout every time. Without these caps, a few such devices (each
 * push fans out to all of them, each retried) hold every slot for minutes
 * and nobody else's push goes out.
 * - at most PARALLEL_ATTEMPTS sends at once, PER_USER_ATTEMPTS of them for
 *   one account and PER_HOST_ATTEMPTS to one registered domain, whoever
 *   owns the devices (the cap on the domain covers a wildcard DNS name
 *   handing out a new host for every device, and several accounts);
 * - a sweep takes at most PER_USER_BATCH due deliveries per account, oldest
 *   first and interleaved, so a backlog cannot push others out of the batch;
 * - a delivery to a UnifiedPush endpoint that could not be reached
 *   (timeout, refused, no DNS answer, TLS) is dropped after
 *   UNREACHABLE_MAX_ATTEMPTS tries instead of MAX_ATTEMPTS;
 * - a device with UNREACHABLE_CIRCUIT_FAILURES such drops within
 *   UNREACHABLE_CIRCUIT_WINDOW_MS gets no more attempts until the window has
 *   passed (then one push finds out whether it is back).
 * Apple and Google are not user-chosen addresses; only the first two caps
 * apply to them.
 */
export const PARALLEL_ATTEMPTS = 5;
export const PER_USER_ATTEMPTS = 2;
export const PER_HOST_ATTEMPTS = 2;
export const PER_USER_BATCH = 10;
export const UNREACHABLE_MAX_ATTEMPTS = 3;
export const UNREACHABLE_CIRCUIT_FAILURES = 3;
export const UNREACHABLE_CIRCUIT_WINDOW_MS = 60 * 60 * 1000;

/** Send errors that mean "nothing answered", as the senders name them. */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
	"timeout",
	"connection_refused",
	"connection_error",
	"dns_failed",
	"tls_error",
]);

export function isUnreachable(code: string): boolean {
	return UNREACHABLE_CODES.has(code);
}

/** The host a cap counts a UnifiedPush endpoint under: its last two labels, or null when it is not a URL. */
export function capHostOf(endpoint: string | null): string | null {
	if (!endpoint) return null;
	let hostname: string;
	try {
		hostname = new URL(endpoint).hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		return null;
	}
	// An address (or a bracketed IPv6 one) is its own host.
	if (/^[\d.]+$/.test(hostname) || hostname.startsWith("[")) return hostname;
	return hostname.split(".").slice(-2).join(".");
}

/** Finished deliveries are kept this long for debugging, then deleted. */
export const RETENTION_DAYS = 7;

/** The wait after the `attempt`-th failed attempt (1 for the first), or null when none is left. */
export function retryDelayMs(attempt: number, hintMs?: number): number | null {
	if (attempt >= MAX_ATTEMPTS) return null;
	const own = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
	// A push service that says when to come back is believed, within the cap.
	return Math.min(Math.max(own, hintMs ?? 0), MAX_DELAY_MS);
}
