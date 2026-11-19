/**
 * Keyed hashes of values the server must not keep in the clear but still needs
 * to count by (an address in a rate limit key). The one owner of the
 * derivation: an HMAC-SHA256 under a key derived from the auth secret with one
 * label per purpose, so a hash made for one purpose is no use for another, and a
 * table or backup holding them cannot be checked against a list of values
 * without the secret. Add a purpose here, never a second derivation elsewhere.
 */
import { createHmac } from "node:crypto";
import { env } from "~/env";

/** One label per use. A label is never reused and never changed: it is the key. */
export const KEYED_HASH_PURPOSES = {
	/** The per-address limit on password reset requests (services/auth/reset-tokens). */
	resetAddress: "reset-request-address",
	/** The per-address limit on prelogin (api/v1/auth). */
	preloginAddress: "prelogin-address",
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
