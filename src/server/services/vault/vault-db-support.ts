/** Raw reads and cleanup for the vault pg tests, as the owner (the app role is RLS-scoped). */
import { adminDb } from "~/test/pg-harness";

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
