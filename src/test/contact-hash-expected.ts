/**
 * The contact hash derivation of contact-hash.ts written out again with
 * node:crypto, so a test's expected value does not come from the code under
 * test: HKDF-SHA256 of the lowest key id's bytes (no salt, info = the label)
 * gives the index key, HMAC-SHA256 of the text under it the index, and
 * HKDF with info "<label> key tag" (8 bytes) the tag.
 */
import { createHmac, hkdfSync } from "node:crypto";
import type { Keyring } from "~/server/crypto/field-crypto";

export const SHADOW_LABEL = "retrospend shadow email hash v1";
export const GUEST_LABEL = "retrospend guest email hash v1";

export function expectedContactHash(
	ring: Keyring,
	label: string,
	normalized: string,
): string {
	const lowest = ring.ids[0];
	const key = ring.keyFor(lowest ?? 0)?.export();
	if (!key) throw new Error("the ring has no key");
	const indexKey = Buffer.from(
		hkdfSync("sha256", key, Buffer.alloc(0), label, 32),
	);
	const tag = Buffer.from(
		hkdfSync("sha256", key, Buffer.alloc(0), `${label} key tag`, 8),
	).toString("hex");
	return `${tag}:${createHmac("sha256", indexKey).update(normalized, "utf8").digest("hex")}`;
}
