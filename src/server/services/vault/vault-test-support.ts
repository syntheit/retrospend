/**
 * Fixtures for the vault tests: real sealed records made by @retrospend/crypto
 * (the bytes a client would send) and the writes built from them. No database,
 * so the unit tests can use it.
 */
import {
	type Json,
	type Primitives,
	type RecordContext,
	sealRecord,
} from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import type { VaultWrite } from "./validate";

const KEY = {
	keyId: new Uint8Array(16).fill(7),
	key: new Uint8Array(32).fill(9),
};

let primitives: Primitives | undefined;
export async function sealer() {
	primitives ??= await createWebPrimitives();
	const p = primitives;
	/** A sealed record for this place; `size` makes the JSON that long. */
	return (
		ctx: RecordContext,
		record: { [key: string]: Json } = { note: "x" },
	): Uint8Array => sealRecord(p, KEY, ctx, 1, record);
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
				),
	};
}
