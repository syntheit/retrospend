/**
 * Server-side encryption of one text field, AES-256-GCM through node:crypto
 * (docs/roadmap/e2ee-spike.md 4.5 and 4.6, lane D).
 *
 * Wire form, a plain string that fits a text column:
 *
 *   "\u0001k1:" + base64( keyId u32 BE | nonce 12 | ciphertext | tag 16 )
 *
 * The prefix names the format; the colon ends the version number, so a later
 * "k10:" cannot be mistaken for "k1:" plus base64. Any value that starts with
 * U+0001 is ciphertext: an unknown format version is an error, never
 * plaintext. The prefix cannot be typed into a field declared through
 * `userText()`, which rejects U+0001. That is all this guarantees: other
 * write paths still accept any string, so D11 must move every encrypted
 * field to `userText` and scan existing rows for a leading U+0001 first.
 *
 * AAD, built by `buildAad` (unambiguous, length-prefixed):
 *
 *   "rs.k1" | keyId u32 BE | (u32 BE length | UTF-8) for table, column, row id
 *
 * It binds the value to its table, column and row, and to the key id that
 * sits in the clear in the header, so moving a ciphertext to another cell or
 * relabeling its key id fails the tag check.
 *
 * The nonce is 12 random bytes from the OS for every call, never derived and
 * never supplied by a caller. With random 96-bit nonces one key is safe for
 * about 2^32 encryptions (NIST SP 800-38D 8.3). The keys used here are
 * per-user data keys and the master key that wraps them, far below that.
 *
 * Key ids let keys rotate: a keyring holds several keys, writes use the
 * current one, reads pick the key named in the value. The tag check inside
 * OpenSSL is constant time. Errors carry a stable code and a fixed message,
 * never a key, a key id, a plaintext or a ciphertext.
 */

import {
	createCipheriv,
	createDecipheriv,
	createSecretKey,
	type KeyObject,
	randomBytes,
} from "node:crypto";
import { hasLoneSurrogate } from "@retrospend/api-contract/common";

const PREFIX = "\u0001k1:";
const AAD_TAG = "rs.k1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_BYTES = 4;
const MAX_KEY_ID = 0xffffffff;
/** Strict standard base64 with padding. Buffer.from alone accepts junk. */
const BASE64 =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type FieldCryptoErrorCode =
	/** A key or the key setting is not usable. */
	| "bad_key"
	/** The cell description (table, column, row id) is empty. */
	| "bad_aad"
	/** The plaintext cannot be stored as UTF-8 text. */
	| "bad_plaintext"
	/** The value starts like ciphertext but is not a well-formed one. */
	| "malformed"
	/** A value of a format version this build does not know. */
	| "unsupported_version"
	/** The value names a key id the keyring does not hold. */
	| "unknown_key"
	/** Wrong key, wrong cell (AAD) or altered bytes. */
	| "auth_failed"
	/** A bulk write (updateMany) sets text: each cell needs its own row id. */
	| "bulk_text_write"
	/** A write of text names no row id to bind it to. */
	| "missing_row_id"
	/** A nested write of text names no row id to bind it to. */
	| "unsealable_nested"
	/** User-class text written for an owner whose key this client does not hold. */
	| "foreign_owner"
	/** A category name written without its name index (E2EE D9). */
	| "category_index_missing";

const MESSAGES: Record<FieldCryptoErrorCode, string> = {
	bad_key: "The field encryption key is not valid",
	bad_aad: "The field cell is not fully named",
	bad_plaintext: "The text cannot be encrypted",
	malformed: "The encrypted value is malformed",
	unsupported_version: "The encrypted value has an unsupported format version",
	unknown_key: "The encrypted value names a key this server does not hold",
	auth_failed: "The encrypted value did not verify",
	bulk_text_write: "A bulk write cannot set encrypted text",
	missing_row_id: "Encrypted text needs the id of the row it is written to",
	unsealable_nested: "A nested write of encrypted text needs the id of its row",
	foreign_owner: "Encrypted text can only be written for the client's own user",
	category_index_missing: "A category name needs its name index",
};

export class FieldCryptoError extends Error {
	readonly code: FieldCryptoErrorCode;
	constructor(code: FieldCryptoErrorCode) {
		super(MESSAGES[code]);
		this.name = "FieldCryptoError";
		this.code = code;
	}
}

/** The cell a value lives in. Row ids are client-generatable and never reused. */
export type FieldAad = { table: string; column: string; rowId: string };

/**
 * Keys by id; the first entry is the current key and seals new values. Keys
 * are held as KeyObjects in private state, so logging or serializing a
 * keyring shows no key bytes.
 */
export class Keyring {
	readonly #keys: ReadonlyMap<number, KeyObject>;
	readonly #currentId: number;

	constructor(entries: ReadonlyArray<{ id: number; key: Buffer }>) {
		const first = entries[0];
		if (!first) throw new FieldCryptoError("bad_key");
		const keys = new Map<number, KeyObject>();
		for (const { id, key } of entries) {
			if (
				!Number.isInteger(id) ||
				id < 1 ||
				id > MAX_KEY_ID ||
				keys.has(id) ||
				key.length !== KEY_BYTES ||
				key.every((byte) => byte === 0)
			)
				throw new FieldCryptoError("bad_key");
			keys.set(id, createSecretKey(key));
		}
		this.#keys = keys;
		this.#currentId = first.id;
	}

	get currentId(): number {
		return this.#currentId;
	}

	has(id: number): boolean {
		return this.#keys.has(id);
	}

	/** The key ids the ring holds, lowest first. */
	get ids(): number[] {
		return [...this.#keys.keys()].sort((a, b) => a - b);
	}

	/** For seal and open in this module; callers have no use for it. */
	keyFor(id: number): KeyObject | undefined {
		return this.#keys.get(id);
	}

	toJSON(): string {
		return "[Keyring]";
	}
}

function lengthPrefixed(text: string): Buffer {
	const body = Buffer.from(text, "utf8");
	const head = Buffer.alloc(4);
	head.writeUInt32BE(body.length);
	return Buffer.concat([head, body]);
}

/** Exported so tests can pin the layout. */
export function buildAad(keyId: number, aad: FieldAad): Buffer {
	for (const part of [aad.table, aad.column, aad.rowId]) {
		if (typeof part !== "string" || part.length === 0)
			throw new FieldCryptoError("bad_aad");
	}
	const id = Buffer.alloc(KEY_ID_BYTES);
	id.writeUInt32BE(keyId);
	return Buffer.concat([
		Buffer.from(AAD_TAG, "ascii"),
		id,
		lengthPrefixed(aad.table),
		lengthPrefixed(aad.column),
		lengthPrefixed(aad.rowId),
	]);
}

/** True for any value that is ciphertext (or claims to be). */
export function isSealedField(value: string): boolean {
	return value.startsWith("\u0001");
}

/** Encrypt `plaintext` with the keyring's current key. */
export function sealField(
	keyring: Keyring,
	plaintext: string,
	aad: FieldAad,
): string {
	if (hasLoneSurrogate(plaintext)) throw new FieldCryptoError("bad_plaintext");
	const keyId = keyring.currentId;
	const key = keyring.keyFor(keyId);
	if (!key) throw new FieldCryptoError("bad_key");
	const aadBytes = buildAad(keyId, aad);
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, nonce, {
		authTagLength: TAG_BYTES,
	});
	cipher.setAAD(aadBytes);
	const body = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const head = Buffer.alloc(KEY_ID_BYTES);
	head.writeUInt32BE(keyId);
	return (
		PREFIX +
		Buffer.concat([head, nonce, body, cipher.getAuthTag()]).toString("base64")
	);
}

/** Decrypt a value `sealField` produced. Plaintext is not accepted here. */
export function openField(
	keyring: Keyring,
	sealed: string,
	aad: FieldAad,
): string {
	if (!sealed.startsWith("\u0001")) throw new FieldCryptoError("malformed");
	if (!sealed.startsWith(PREFIX)) {
		// "\u0001k", digits and a colon is a format this build does not know; anything
		// else is not one of ours.
		throw new FieldCryptoError(
			/^k[0-9]+:/.test(sealed.slice(1)) ? "unsupported_version" : "malformed",
		);
	}
	const encoded = sealed.slice(PREFIX.length);
	if (!BASE64.test(encoded)) throw new FieldCryptoError("malformed");
	const raw = Buffer.from(encoded, "base64");
	if (raw.length < KEY_ID_BYTES + NONCE_BYTES + TAG_BYTES)
		throw new FieldCryptoError("malformed");
	const keyId = raw.readUInt32BE(0);
	const key = keyring.keyFor(keyId);
	if (!key) throw new FieldCryptoError("unknown_key");
	const aadBytes = buildAad(keyId, aad);
	const nonce = raw.subarray(KEY_ID_BYTES, KEY_ID_BYTES + NONCE_BYTES);
	const body = raw.subarray(KEY_ID_BYTES + NONCE_BYTES, raw.length - TAG_BYTES);
	const tag = raw.subarray(raw.length - TAG_BYTES);
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
			authTagLength: TAG_BYTES,
		});
		decipher.setAAD(aadBytes);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(body), decipher.final()]).toString(
			"utf8",
		);
	} catch {
		// OpenSSL's message is dropped on purpose; the code says enough.
		throw new FieldCryptoError("auth_failed");
	}
}

/**
 * The value of a column that holds both forms during the backfill: plaintext
 * passes through, ciphertext is decrypted. The pass-through ends when the D12
 * backfill finishes; after that a plaintext value is a bug and should throw.
 * Crypto-shredding a user's key before their rows are backfilled destroys
 * nothing, because those rows are still plaintext.
 */
export function readField(
	keyring: Keyring,
	value: string,
	aad: FieldAad,
): string {
	return isSealedField(value) ? openField(keyring, value, aad) : value;
}
