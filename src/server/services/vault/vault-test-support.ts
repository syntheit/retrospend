/**
 * Fixtures for the vault tests: real sealed records made by @retrospend/crypto
 * (the bytes a client would send) and the writes built from them. No database,
 * so the unit tests can use it.
 */
import {
	type Json,
	type Primitives,
	type RecordContext,
	type RecordKey,
	sealRecord,
	toHex,
} from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import type { VaultWrite } from "./validate";

const KEY: RecordKey = {
	keyId: new Uint8Array(16).fill(7),
	key: new Uint8Array(32).fill(9),
};
/** A later generation's collection key: what turning protection on again makes. */
export const SECOND_KEY: RecordKey = {
	keyId: new Uint8Array(16).fill(8),
	key: new Uint8Array(32).fill(10),
};

/** The key id the fixtures seal under, as a collection-key wrap's targetId. */
export const KEY_ID_HEX = toHex(KEY.keyId);
export const SECOND_KEY_ID_HEX = toHex(SECOND_KEY.keyId);

let primitives: Primitives | undefined;
export async function sealer() {
	primitives ??= await createWebPrimitives();
	const p = primitives;
	/** A sealed record for this place; `size` makes the JSON that long. */
	return (
		ctx: RecordContext,
		record: { [key: string]: Json } = { note: "x" },
		key: RecordKey = KEY,
	): Uint8Array => sealRecord(p, key, ctx, 1, record);
}

/** The context a write to `id` at `baseVersion` is sealed under. */
export const contextOf = (
	userId: string,
	id: string,
	baseVersion: number,
	collectionId = "col1",
	entity = 40,
): RecordContext => ({
	userId,
	collectionId,
	entity,
	recordId: id,
	version: baseVersion + 1,
});

export type Sealer = Awaited<ReturnType<typeof sealer>>;

/**
 * A write of `id` at `baseVersion`, sealed for its place (the AAD binds the
 * user, collection, entity, id and the version the write becomes).
 */
export function writeOf(
	seal: Sealer,
	userId: string,
	id: string,
	baseVersion: number,
	over: {
		collectionId?: string;
		entity?: number;
		record?: { [key: string]: Json };
		tombstone?: boolean;
		/** The collection key to seal under; the fixtures' first key when omitted. */
		key?: RecordKey;
	} = {},
): VaultWrite {
	const collectionId = over.collectionId ?? "col1";
	const entity = over.entity ?? 40;
	return {
		id,
		collectionId,
		entity,
		baseVersion,
		ciphertext: over.tombstone
			? null
			: seal(
					contextOf(userId, id, baseVersion, collectionId, entity),
					over.record,
					over.key,
				),
	};
}
