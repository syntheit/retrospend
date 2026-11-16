/**
 * What a client asks before signing in: how to turn the typed password into
 * the sign-in secret. An account with a protection key set answers with its
 * Argon2id salt and parameters; every other address (keyless account, no
 * account) answers null, so the answer proves no account exists.
 *
 * It runs on the owner connection, like the sign-in lookup better-auth makes
 * for the same address: there is no session yet, so the user-scoped client
 * cannot be built, and the key set is protected by row-level security that a
 * caller without a session cannot satisfy. A SECURITY DEFINER function would
 * give the same rows to the same owner connection (the app role never runs
 * this) and add a migration, a grant and a definer-catalog entry for nothing.
 * What leaves is the public salt and the parameters, never a wrap.
 */
import type { PreloginKdf } from "@retrospend/api-contract";
import { toBase64Url } from "@retrospend/crypto";
import { db } from "~/server/db";

type Row = {
	kdfSalt: Uint8Array | null;
	kdfMemoryKiB: number | null;
	kdfPasses: number | null;
};

/** The address as sign-up stores it: lowercased and trimmed. The one place that says so. */
export const normalizeEmail = (email: string): string =>
	email.trim().toLowerCase();

/**
 * One query for every address, so a keyed account costs one row more and
 * nothing else. The address is matched lowercased: sign-up stores it that way.
 */
export async function readPreloginKdf(
	email: string,
): Promise<PreloginKdf | null> {
	const [row] = await db.$queryRaw<Row[]>`
		SELECT s."kdfSalt", s."kdfMemoryKiB", s."kdfPasses"
		FROM (SELECT ${normalizeEmail(email)}::text AS "email") q
		LEFT JOIN "user" u ON u."email" = q."email"
		LEFT JOIN "protection_key_set" s ON s."userId" = u."id"`;
	if (!row?.kdfSalt || row.kdfMemoryKiB === null || row.kdfPasses === null)
		return null;
	return {
		salt: toBase64Url(Uint8Array.from(row.kdfSalt)),
		memoryKiB: row.kdfMemoryKiB,
		passes: row.kdfPasses,
	};
}
