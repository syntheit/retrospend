/**
 * `Idempotency-Key` (IMPLEMENTATION §2.2). Every write (POST, PUT, PATCH,
 * DELETE) requires the header. The server stores the first successful
 * response for 24 hours per user and key:
 * - the same key with the same request replays that response, with
 *   `Idempotent-Replayed: true`, and writes nothing;
 * - the same key with a different method, path or body is
 *   `idempotency_key_reused` (422);
 * - a key whose first request is still running is
 *   `idempotency_in_progress` (409); retry after a moment;
 * - a failed request does not keep its key, so the client may retry it.
 * Routes whose response holds a secret shown once (a new API key) keep
 * only the fact that the key was used; a replay is
 * `idempotency_replay_unavailable` (409).
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Printable ASCII without spaces, as Stripe and the IETF draft allow. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export function isValidIdempotencyKey(key: string): boolean {
	return IDEMPOTENCY_KEY_PATTERN.test(key);
}

export const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export function isWriteMethod(method: string): boolean {
	return (WRITE_METHODS as readonly string[]).includes(method.toUpperCase());
}
