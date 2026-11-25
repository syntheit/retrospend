/**
 * Keyed hashes of values the server must not keep in the clear but still needs
 * to count by (an address in a rate limit key), and signatures over a payload.
 * The one owner of HMACs under a key derived from the auth secret: an
 * HMAC-SHA256 under a key derived with one label per purpose, so a hash made
 * for one purpose is no use for another, and a table or backup holding them
 * cannot be checked against a list of values without the secret. Add a purpose
 * here, never a second HMAC derivation elsewhere. (The webhook secret key in
 * services/webhooks/secret.ts is an HKDF encryption key, a different job.)
 *
 * Two token HMACs stay outside this module:
 * - src/lib/claim-token.ts signs under the raw BETTER_AUTH_SECRET with no label.
 *   That is safe only because a claim payload is always four ":"-joined fields
 *   and no label here contains ":", so a claim signature can never equal a
 *   purpose key. The keyed-hash test enforces the label rule.
 * - src/lib/unsubscribe-token.ts signs under UNSUBSCRIBE_SECRET, a separate
 *   operator setting, not the auth secret. Moving it here would change which
 *   secret signs it.
 * Moving either would void every link already sent, so they wait for a
 * dual-verify window the owner schedules (docs/roadmap/expense-write-findings-2026-11-18.md,
 * "Security follow-ups"). Their tests pin today's output.
 */
import { createHmac } from "node:crypto";
import { env } from "~/env";

/** One label per use. A label is never reused and never changed: it is the key. */
export const KEYED_HASH_PURPOSES = {
	/** The per-address limit on password reset requests (services/auth/reset-tokens). */
	resetAddress: "reset-request-address",
	/** The per-address limit on prelogin (api/v1/auth). */
	preloginAddress: "prelogin-address",
	/** The fingerprint of an API v1 request under one Idempotency-Key (api-v1/idempotency.service). */
	idempotencyFingerprint: "idempotency-fingerprint",
	/** The signature on an export download link (api-v1/export-link). */
	exportDownload: "api-v1-export-download",
	/** The signature on a signed undo payload (entry/restore-token). */
	restoreToken: "entry-restore-token",
} as const;
export type KeyedHashPurpose = keyof typeof KEYED_HASH_PURPOSES;

const keys = new Map<KeyedHashPurpose, Buffer>();

/** Hex HMAC-SHA256 of `value` under the key derived for `purpose`. */
export function keyedHash(purpose: KeyedHashPurpose, value: string): string {
	let key = keys.get(purpose);
	if (!key) {
		key = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(KEYED_HASH_PURPOSES[purpose])
			.digest();
		keys.set(purpose, key);
	}
	return createHmac("sha256", key).update(value).digest("hex");
}
