/** Raw reads and cleanup for the vault pg tests, as the owner (the app role is RLS-scoped). */
import { adminDb } from "~/test/pg-harness";
import { KEY_ID_HEX } from "./vault-test-support";

/**
 * A collection-key wrap for the key id the fixtures seal under, so a write of
 * the fixtures' records passes the key check. The wrapped bytes are filler:
 * the server never opens a wrap, so only the table's format check (74 bytes,
 * version 1, symmetric) matters.
 */
export async function wrapFixtureKey(userId: string, keyIdHex = KEY_ID_HEX) {
	await adminDb.protectionKeyWrap.create({
		data: {
			userId,
			role: "collection-key",
			targetId: keyIdHex,
			wrapped: Buffer.concat([Buffer.from([1, 1]), Buffer.alloc(72, 1)]),
		},
	});
}

/** Every vault row of a user, as the owner (the app role's view is RLS-scoped). */
export async function vaultRowsOf(userId: string) {
	return adminDb.$queryRaw<
		{
			id: string;
			version: number;
			txid: string;
			seq: string;
			deletedAt: Date | null;
			size: number | null;
		}[]
	>`
		SELECT "id", "version", "txid"::text AS "txid", "seq"::text AS "seq", "deletedAt",
		       octet_length("ciphertext") AS "size"
		FROM "vault_record" WHERE "userId" = ${userId} ORDER BY "txid", "seq"`;
}

/** Removes every vault row the file wrote: the rollback test needs the table empty. */
export async function clearVault() {
	await adminDb.$executeRaw`DELETE FROM "vault_record"`;
}
