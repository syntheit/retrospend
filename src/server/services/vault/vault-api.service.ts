/**
 * What the /vault routes run (E2EE F7b): the sealed record store behind a user
 * transaction, with the wire's base64url text turned into bytes and back. The
 * route layer validates and authorizes; nothing here logs a record or its
 * bytes.
 */
import type {
	VaultChangesDto,
	VaultChangesQuery,
	VaultWriteDto,
} from "@retrospend/api-contract";
import { fromBase64Url } from "@retrospend/crypto";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { VaultError } from "./errors";
import {
	applyVaultWrites,
	readVaultChanges,
	type VaultWrite,
} from "./vault.service";

/**
 * A write transaction may run longer than Prisma's 5 seconds: 500 writes over
 * 8 MiB where every one conflicts is about a thousand statements. It is still
 * bounded, so a stuck batch cannot hold a connection and the row locks of a
 * reset that waits behind it.
 */
export const VAULT_WRITE_TIMEOUT_MS = 30_000;

/** Strict decode: a text that is not canonical base64url is a malformed write. */
function toWrite(w: VaultWriteDto): VaultWrite {
	let ciphertext: Uint8Array | null = null;
	if (w.ciphertext !== null) {
		ciphertext = fromBase64Url(w.ciphertext);
		if (ciphertext === null) throw new VaultError("invalid_input");
	}
	return { ...w, ciphertext };
}

/**
 * Stores a batch for a user who has a key set, all or nothing. The key set row
 * is read FOR SHARE in the write's own transaction: a reset that removes the
 * keys (and the account's vault rows) waits for this batch to finish, or runs
 * first and this batch sees no key set. Either way no record is left that no
 * key can open.
 */
export async function writeVaultRecords(
	db: typeof globalDb,
	userId: string,
	writes: readonly VaultWriteDto[],
): Promise<{ id: string; version: number }[]> {
	const decoded = writes.map(toWrite);
	return userTransaction(
		db,
		userId,
		async (tx) => {
			const keys = await tx.$queryRaw<{ one: number }[]>`
				SELECT 1 AS "one" FROM "protection_key_set"
				WHERE "userId" = ${userId} FOR SHARE`;
			if (keys.length === 0) throw new VaultError("keys_missing");
			return applyVaultWrites(tx, userId, decoded);
		},
		{ timeout: VAULT_WRITE_TIMEOUT_MS },
	);
}

/** One page of the caller's records after a cursor, in the wire form. */
export async function pullVaultChanges(
	db: typeof globalDb,
	userId: string,
	query: VaultChangesQuery,
): Promise<VaultChangesDto> {
	const page = await userTransaction(db, userId, (tx) =>
		readVaultChanges(tx, userId, query.cursor, { limit: query.limit }),
	);
	return {
		records: page.records.map((r) => ({
			id: r.id,
			collectionId: r.collectionId,
			entity: r.entity,
			version: r.version,
			ciphertext:
				r.ciphertext === null
					? null
					: Buffer.from(r.ciphertext).toString("base64url"),
			deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
		})),
		cursor: page.cursor,
		hasMore: page.hasMore,
	};
}
