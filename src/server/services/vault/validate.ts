/**
 * What a batch of vault writes may contain, checked before any query. The
 * server never opens a record, so this is shape only: the id pattern, the
 * entity range and the sealed record's size and header, the same facts the
 * migration's CHECKs pin (20261116100000_vault_record). Sizes come from
 * @retrospend/crypto, so a format change there fails the unit test with real
 * records before it fails in production.
 */
import {
	ALGORITHM_XCHACHA20_POLY1305,
	FORMAT_VERSION,
	HEADER_BYTES,
	MAX_PLAINTEXT_BYTES,
	PAD_BUCKET_BYTES,
	TAG_BYTES,
} from "@retrospend/crypto";
import { VaultError } from "./errors";

/** One record write. `ciphertext` null writes a tombstone. */
export type VaultWrite = {
	id: string;
	collectionId: string;
	/** Entity number: the clients' registry, stored as given. */
	entity: number;
	/** The version the caller read; 0 creates the record. The write is `baseVersion + 1`. */
	baseVersion: number;
	ciphertext: Uint8Array | null;
};

/** keys.ts and format.ts `ID`: the pattern an id must match to be bound into an AAD. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** More than a device pushes at once; bounds a request. */
export const MAX_WRITES = 500;
/** Ciphertext in one batch. A record may be 1 MiB, so the count alone allows 500 MiB. */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;
/** The AAD allows 0xffff (format.ts recordAad). */
const MAX_ENTITY = 0xffff;
/** `version` is a 32-bit column and the write is baseVersion + 1. */
const MAX_BASE_VERSION = 2 ** 31 - 2;

const MIN_RECORD_BYTES = HEADER_BYTES + TAG_BYTES + PAD_BUCKET_BYTES;
const MAX_RECORD_BYTES = HEADER_BYTES + TAG_BYTES + MAX_PLAINTEXT_BYTES;

const bad = (): never => {
	throw new VaultError("invalid_input");
};

/** Whether `bytes` could be a sealed record: its size and its two format bytes. */
export function isSealedShape(bytes: Uint8Array): boolean {
	return (
		bytes.length >= MIN_RECORD_BYTES &&
		bytes.length <= MAX_RECORD_BYTES &&
		(bytes.length - HEADER_BYTES - TAG_BYTES) % PAD_BUCKET_BYTES === 0 &&
		bytes[0] === FORMAT_VERSION &&
		bytes[1] === ALGORITHM_XCHACHA20_POLY1305
	);
}

/** Throws `VaultError("invalid_input")` for anything the table would refuse or a write cannot mean. */
export function validateVaultWrites(writes: readonly VaultWrite[]): void {
	if (writes.length > MAX_WRITES) bad();
	const seen = new Set<string>();
	let bytes = 0;
	for (const w of writes) {
		if (!ID.test(w.id) || !ID.test(w.collectionId)) bad();
		if (!Number.isInteger(w.entity) || w.entity < 1 || w.entity > MAX_ENTITY)
			bad();
		if (
			!Number.isInteger(w.baseVersion) ||
			w.baseVersion < 0 ||
			w.baseVersion > MAX_BASE_VERSION
		)
			bad();
		// A tombstone needs a record to end; a record exists from version 1.
		if (w.ciphertext === null) {
			if (w.baseVersion === 0) bad();
		} else {
			if (!isSealedShape(w.ciphertext)) bad();
			bytes += w.ciphertext.length;
		}
		// Two writes to one id in a batch have no order the caller can have meant.
		if (seen.has(w.id)) bad();
		seen.add(w.id);
	}
	if (bytes > MAX_BATCH_BYTES) bad();
}
