/**
 * Blind index: a keyed hash of a short text, so the server can ask "is this
 * text already used" without reading the text (docs/roadmap/e2ee-spike.md
 * section 3, lane D9). Equal texts under one user's keyring give equal
 * indexes; the same text under two users' keyrings gives different ones.
 *
 *   indexKey = HKDF-SHA256(ikm = the user's oldest data key, salt = none, info = <label>)
 *   index    = hex( HMAC-SHA256(indexKey, UTF-8 text) )
 *   tag      = hex( first 8 bytes of HKDF-SHA256(same ikm, info = <label> + " key tag") )
 *
 * The oldest key signs, not the current one: a rotation that adds a newer key
 * (see master-key.ts, which only rewraps data keys) must not change every
 * index. The tag names the key material an index was made with. A caller
 * stores it next to the index and trusts an index only while the stored tag
 * equals the current one. A key id would not do: a data key that is lost and
 * made again (a restore of the main dump without the keystore) gets key id 1
 * again, with other bytes, and every index made with the old bytes is stale.
 * The tag is 64 bits of a PRF output, enough to notice a changed key, and
 * shows nothing of the key. The label (HKDF info) keeps one index from being
 * usable as another's.
 *
 * The index is deterministic on purpose, so it shows which rows of one user
 * share a text; the output is a fixed size and shows no length. It is not a
 * secret from anyone holding the user's data key. Callers decide what
 * normalization makes two texts "the same" before calling.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { FieldCryptoError, type Keyring } from "./field-crypto";

const INDEX_BYTES = 32;
const TAG_BYTES = 8;

function derive(
	keyring: Keyring,
	label: string,
	info: string,
	bytes: number,
): Buffer {
	const oldest = keyring.ids[0];
	const key = oldest === undefined ? undefined : keyring.keyFor(oldest);
	if (!key || label.length === 0) throw new FieldCryptoError("bad_key");
	return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), info, bytes));
}

export function blindIndex(
	keyring: Keyring,
	label: string,
	text: string,
): string {
	const indexKey = derive(keyring, label, label, INDEX_BYTES);
	return createHmac("sha256", indexKey).update(text, "utf8").digest("hex");
}

/** Names the key material `blindIndex` uses for this label. */
export function blindIndexTag(keyring: Keyring, label: string): string {
	return derive(keyring, label, `${label} key tag`, TAG_BYTES).toString("hex");
}
