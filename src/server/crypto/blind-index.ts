/**
 * Blind index: a keyed hash of a short text, so the server can ask "is this
 * text already used" without reading the text (docs/roadmap/e2ee-spike.md
 * section 3, lane D9). Equal texts under one user's keyring give equal
 * indexes; the same text under two users' keyrings gives different ones.
 *
 *   indexKey = HKDF-SHA256(ikm = the user's oldest data key, salt = none, info = <label>)
 *   index    = hex( HMAC-SHA256(indexKey, UTF-8 text) )
 *
 * The oldest key signs, not the current one: rotation (see master-key.ts)
 * adds a newer key and keeps the old ones, and an index that followed the
 * current key would change for every row at every rotation. Retiring the
 * oldest data key therefore needs the index backfill run again. The label
 * (HKDF info) keeps one index from being usable as another's.
 *
 * The index is deterministic on purpose, so it shows which rows of one user
 * share a text; the output is a fixed size and shows no length. It is not a
 * secret from anyone holding the user's data key. Callers decide
 * what normalization makes two texts "the same" before calling.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { FieldCryptoError, type Keyring } from "./field-crypto";

const INDEX_BYTES = 32;

export function blindIndex(
	keyring: Keyring,
	label: string,
	text: string,
): string {
	const oldest = keyring.ids[0];
	const key = oldest === undefined ? undefined : keyring.keyFor(oldest);
	if (!key || label.length === 0) throw new FieldCryptoError("bad_key");
	const indexKey = Buffer.from(
		hkdfSync("sha256", key, Buffer.alloc(0), label, INDEX_BYTES),
	);
	return createHmac("sha256", indexKey).update(text, "utf8").digest("hex");
}
