import * as Crypto from "expo-crypto";

/**
 * An id made on the phone, so a record exists (and can be edited) before the
 * server has seen it. The server accepts it as the row id and uses it as the
 * idempotency key, so a retried write never doubles (owner rule 9).
 */
export function newClientId(): string {
	return Crypto.randomUUID();
}
