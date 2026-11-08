// The sealed record format (spike section 4.5). One record, one encrypted
// payload:
//
//   byte 0       format version (1)
//   byte 1       algorithm (1 = XChaCha20-Poly1305-IETF)
//   bytes 2..17  keyId, names the collection key version
//   bytes 18..41 nonce, 24 random bytes (random is safe at this size)
//   bytes 42..   ciphertext, then the 16-byte tag
//   plaintext    schema version (u16, big endian) | canonical JSON | padding
//   AAD          "rs.v1|<header hex>|userId|collectionId|entity|recordId|version"
//                where <header hex> is bytes 0..17 (version, algorithm, keyId) as
//                36 lowercase hex characters
//
// Why it is built this way:
// - The AAD binds the record to its place. The server can store, withhold or
//   roll back sealed records, but moving one to another id, entity, version,
//   user or collection makes it fail to open. Rollback to an older version of
//   the same record is caught by the device's high-water mark, not here.
// - Padding hides length: ISO/IEC 7816-4 style (0x80, then zeros) up to the
//   next multiple of 64 bytes. A record always gains at least the 0x80 byte.
// - The JSON is deterministic and pure ASCII (keys sorted, no spaces, every
//   character above 0x7e written as a \u escape) so every platform produces
//   the same bytes without a UTF-8 codec, and the golden vectors can pin them.
// - The header is not encrypted but it is authenticated: its first 18 bytes
//   are in the AAD, so a rewritten keyId fails to open even if the reader
//   would hand out the key for it. A version or algorithm this build does not
//   know is refused with `invalid_input` before any decryption (read it first
//   with `readHeader` to tell the user to update). A keyId that names no key,
//   a changed keyId, a wrong place and changed bytes all fail the same way,
//   `decrypt_failed`, so a failure never says which. The nonce needs no
//   binding: the cipher takes it as an input.
// - Only `invalid_input` and `decrypt_failed` exist (errors.ts). An authentic
//   record this version cannot read is `decrypt_failed` too.
import { fromBase64Url, toBase64Url } from "./base64url";
import { CryptoError } from "./errors";
import { toHex } from "./hex";
import {
	KEY_BYTES,
	NONCE_BYTES,
	type Primitives,
	TAG_BYTES,
} from "./primitives";

export const FORMAT_VERSION = 1;
export const ALGORITHM_XCHACHA20_POLY1305 = 1;
export const KEY_ID_BYTES = 16;
export const HEADER_BYTES = 2 + KEY_ID_BYTES + NONCE_BYTES;
export const PAD_BUCKET_BYTES = 64;
/** Largest plaintext (schema version, JSON and padding) accepted either way. */
export const MAX_PLAINTEXT_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;

export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };

/** Where a record lives. Everything here goes into the AAD. */
export interface RecordContext {
	userId: string;
	collectionId: string;
	/** Entity type, a small integer. */
	entity: number;
	recordId: string;
	version: number;
}

export interface RecordKey {
	keyId: Uint8Array;
	key: Uint8Array;
}

export interface OpenedRecord {
	schemaVersion: number;
	record: { [key: string]: Json };
}

const bad = (): never => {
	throw new CryptoError("invalid_input");
};
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const safeInt = (v: number, max: number) =>
	Number.isSafeInteger(v) && v >= 0 && v <= max ? v : bad();

/**
 * The AAD string (ASCII only: the native AEAD takes a string). `header` is
 * the first 18 bytes of the sealed record. Ids are limited to letters, digits,
 * `-` and `_`, the header is hex and the rest are integers, so `|` cannot
 * appear inside a field and no two inputs produce the same string.
 */
export function recordAad(ctx: RecordContext, header: Uint8Array): string {
	if (header.length !== 2 + KEY_ID_BYTES) bad();
	for (const id of [ctx.userId, ctx.collectionId, ctx.recordId]) {
		if (typeof id !== "string" || !ID.test(id)) bad();
	}
	return [
		"rs.v1",
		toHex(header),
		ctx.userId,
		ctx.collectionId,
		safeInt(ctx.entity, 0xffff),
		ctx.recordId,
		safeInt(ctx.version, Number.MAX_SAFE_INTEGER),
	].join("|");
}

function quote(text: string): string {
	let out = '"';
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const ch = text.charAt(i);
		if (ch === '"') out += '\\"';
		else if (ch === "\\") out += "\\\\";
		else if (code === 8) out += "\\b";
		else if (code === 9) out += "\\t";
		else if (code === 10) out += "\\n";
		else if (code === 12) out += "\\f";
		else if (code === 13) out += "\\r";
		else if (code < 0x20 || code > 0x7e) {
			out += `\\u${code.toString(16).padStart(4, "0")}`;
		} else out += ch;
	}
	return `${out}"`;
}

/** Deterministic, ASCII-only JSON. Refuses anything JSON cannot hold exactly. */
export function canonicalJson(value: Json, depth = 0): string {
	if (depth > MAX_DEPTH) bad();
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) bad();
		return JSON.stringify(value);
	}
	if (typeof value === "string") return quote(value);
	if (Array.isArray(value)) {
		// A hole would print as an empty item that no reader can parse.
		for (let i = 0; i < value.length; i++) if (!(i in value)) bad();
		return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
	}
	if (typeof value !== "object") return bad();
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) bad();
	return `{${Object.keys(value)
		.sort()
		.map(
			(k) =>
				`${quote(k)}:${canonicalJson((value as { [k: string]: Json })[k] as Json, depth + 1)}`,
		)
		.join(",")}}`;
}

function pad(body: Uint8Array): Uint8Array {
	const total =
		Math.floor(body.length / PAD_BUCKET_BYTES) * PAD_BUCKET_BYTES +
		PAD_BUCKET_BYTES;
	const out = new Uint8Array(total);
	out.set(body);
	out[body.length] = 0x80;
	return out;
}

/** Returns the bytes before the 0x80 marker, or null if the padding is wrong. */
function unpad(padded: Uint8Array): Uint8Array | null {
	let end = padded.length;
	while (end > 0 && padded[end - 1] === 0) end--;
	if (end === 0 || padded[end - 1] !== 0x80) return null;
	return padded.subarray(0, end - 1);
}

/**
 * Seal with a caller-chosen nonce. For golden vectors only, so it is not in
 * the package index: a nonce must never be reused with a key, so real code
 * calls `sealRecord`.
 */
export function sealRecordWithNonce(
	p: Primitives,
	recordKey: RecordKey,
	ctx: RecordContext,
	schemaVersion: number,
	record: { [key: string]: Json },
	nonce: Uint8Array,
): Uint8Array {
	if (recordKey.keyId.length !== KEY_ID_BYTES) bad();
	safeInt(schemaVersion, 0xffff);
	if (record === null || typeof record !== "object" || Array.isArray(record)) {
		bad();
	}
	const header = new Uint8Array(2 + KEY_ID_BYTES);
	header[0] = FORMAT_VERSION;
	header[1] = ALGORITHM_XCHACHA20_POLY1305;
	header.set(recordKey.keyId, 2);
	const aad = recordAad(ctx, header);
	const json = canonicalJson(record);
	if (json.length + 2 >= MAX_PLAINTEXT_BYTES) bad();
	const body = new Uint8Array(2 + json.length);
	body[0] = schemaVersion >> 8;
	body[1] = schemaVersion & 255;
	for (let i = 0; i < json.length; i++) body[2 + i] = json.charCodeAt(i);
	const padded = pad(body);
	try {
		const encrypted = p.aeadEncrypt(recordKey.key, nonce, padded, aad);
		const out = new Uint8Array(HEADER_BYTES + encrypted.length);
		out.set(header);
		out.set(nonce, 2 + KEY_ID_BYTES);
		out.set(encrypted, HEADER_BYTES);
		return out;
	} finally {
		p.wipe(body);
		p.wipe(padded);
	}
}

export function sealRecord(
	p: Primitives,
	recordKey: RecordKey,
	ctx: RecordContext,
	schemaVersion: number,
	record: { [key: string]: Json },
): Uint8Array {
	return sealRecordWithNonce(
		p,
		recordKey,
		ctx,
		schemaVersion,
		record,
		p.randomBytes(NONCE_BYTES),
	);
}

export interface SealedHeader {
	version: number;
	algorithm: number;
	keyId: Uint8Array;
}

/**
 * The unencrypted header, unauthenticated until `openRecord` succeeds. Lets a
 * caller pick the key (or ask for an app update) before opening. Throws
 * `decrypt_failed` for input too short to hold a record.
 */
export function readHeader(sealed: Uint8Array): SealedHeader {
	if (sealed.length < HEADER_BYTES + TAG_BYTES) {
		throw new CryptoError("decrypt_failed");
	}
	return {
		version: sealed[0] as number,
		algorithm: sealed[1] as number,
		keyId: sealed.slice(2, 2 + KEY_ID_BYTES),
	};
}

/**
 * Open a sealed record. `findKey` maps the header's keyId to its key (or
 * undefined). Throws `invalid_input` for a version or algorithm this build
 * does not know, and `decrypt_failed` for everything else that goes wrong
 * (see the top of this file). Nothing is returned unless the tag verified.
 */
export function openRecord(
	p: Primitives,
	findKey: (keyId: Uint8Array) => Uint8Array | undefined,
	ctx: RecordContext,
	sealed: Uint8Array,
): OpenedRecord {
	const header = readHeader(sealed);
	if (
		header.version !== FORMAT_VERSION ||
		header.algorithm !== ALGORITHM_XCHACHA20_POLY1305
	) {
		throw new CryptoError("invalid_input");
	}
	const encrypted = sealed.subarray(HEADER_BYTES);
	const plainLength = encrypted.length - TAG_BYTES;
	if (
		plainLength < PAD_BUCKET_BYTES ||
		plainLength > MAX_PLAINTEXT_BYTES ||
		plainLength % PAD_BUCKET_BYTES !== 0
	) {
		throw new CryptoError("decrypt_failed");
	}
	const key = findKey(header.keyId);
	if (key === undefined || key.length !== KEY_BYTES) {
		throw new CryptoError("decrypt_failed");
	}
	const padded = p.aeadDecrypt(
		key,
		sealed.slice(2 + KEY_ID_BYTES, HEADER_BYTES),
		encrypted,
		recordAad(ctx, sealed.subarray(0, 2 + KEY_ID_BYTES)),
	);
	try {
		const body = unpad(padded);
		if (body === null || body.length < 2) {
			throw new CryptoError("decrypt_failed");
		}
		let json = "";
		for (let i = 2; i < body.length; i++) {
			const byte = body[i] as number;
			if (byte < 0x20 || byte > 0x7e) throw new CryptoError("decrypt_failed");
			json += String.fromCharCode(byte);
		}
		let record: unknown;
		try {
			record = JSON.parse(json);
		} catch {
			throw new CryptoError("decrypt_failed");
		}
		if (
			record === null ||
			typeof record !== "object" ||
			Array.isArray(record)
		) {
			throw new CryptoError("decrypt_failed");
		}
		return {
			schemaVersion: ((body[0] as number) << 8) | (body[1] as number),
			record: record as { [key: string]: Json },
		};
	} finally {
		p.wipe(padded);
	}
}

/** The wire form: unpadded base64url. */
export const encodeSealed = toBase64Url;

export function decodeSealed(text: string): Uint8Array {
	const bytes = fromBase64Url(text);
	if (bytes === null) throw new CryptoError("decrypt_failed");
	return bytes;
}
