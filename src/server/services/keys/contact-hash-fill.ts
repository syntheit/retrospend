/**
 * The contact hash fill and gate for the DATA_KEYS_WRITE start (E2EE D11
 * Revision 3, PR 3a, owner decision Q5; contact-hash.ts has the rule). Rows
 * saved before the hash existed, or while a replica had no instance ring
 * cached, have no hash or one of another key. The email is readable now and
 * only now (once it is sealed, the creator's key is needed), so the start
 * makes every missing hash itself and refuses to set the epoch until none is
 * missing. No script for the owner to run.
 *
 * The fill runs on the owner connection, outside any transaction, in batches
 * of 500: each batch commits alone, so a crash leaves the rows already done
 * done, and the next start takes the rest. It writes only "emailHash"; the
 * email is not touched, and an `UPDATE` that finds the email changed since the
 * read skips the row (its writer hashed it, or the next batch finds it).
 * Re-running changes nothing once every row is current.
 *
 * A row whose email is already sealed and has no current hash cannot be
 * filled here. Writers fail closed, so none should exist; the gate refuses
 * the start if one does, whatever the cause.
 */
import type { Keyring } from "~/server/crypto/field-crypto";
import { keystoreDb } from "~/server/db-core";
import { type ContactTable, contactHash, contactHashTag } from "./contact-hash";

type Client = Pick<typeof keystoreDb, "$queryRaw" | "$executeRaw">;

export const FILL_BATCH = 500;

/** Every sealed cell starts with U+0001 (field-crypto.ts `isSealedField`). */
const SEALED = "\u0001";

type Candidate = { id: string; email: string };

/** Up to `limit` plaintext rows whose hash is missing or of another key, by id. */
function candidates(
	client: Client,
	table: ContactTable,
	prefix: string,
	limit: number,
): Promise<Candidate[]> {
	return table === "shadow_profile"
		? client.$queryRaw<Candidate[]>`
			SELECT "id", "email" FROM "shadow_profile"
			WHERE "email" IS NOT NULL AND NOT starts_with("email", ${SEALED})
			  AND ("emailHash" IS NULL OR NOT starts_with("emailHash", ${prefix}))
			ORDER BY "id" LIMIT ${limit}`
		: client.$queryRaw<Candidate[]>`
			SELECT "id", "email" FROM "guest_session"
			WHERE NOT starts_with("email", ${SEALED})
			  AND ("emailHash" IS NULL OR NOT starts_with("emailHash", ${prefix}))
			ORDER BY "id" LIMIT ${limit}`;
}

function store(
	client: Client,
	table: ContactTable,
	row: Candidate,
	hash: string,
): Promise<number> {
	return table === "shadow_profile"
		? client.$executeRaw`
			UPDATE "shadow_profile" SET "emailHash" = ${hash}
			WHERE "id" = ${row.id} AND "email" = ${row.email}`
		: client.$executeRaw`
			UPDATE "guest_session" SET "emailHash" = ${hash}
			WHERE "id" = ${row.id} AND "email" = ${row.email}`;
}

/**
 * Hashes every plaintext row of `table` that needs it; returns how many it
 * updated. A batch that updates nothing ends the loop, so a row that keeps
 * changing under it cannot hold the start forever.
 */
export async function fillContactHashes(
	client: Client,
	ring: Keyring,
	table: ContactTable,
	batch: number = FILL_BATCH,
): Promise<number> {
	const prefix = `${contactHashTag(ring, table)}:`;
	let total = 0;
	for (;;) {
		const rows = await candidates(client, table, prefix, batch);
		let updated = 0;
		for (const row of rows)
			updated += await store(
				client,
				table,
				row,
				contactHash(ring, table, row.email),
			);
		total += updated;
		if (updated === 0 || rows.length < batch) return total;
	}
}

/**
 * How many rows with an address lack a hash of the current key: the gate
 * before the epoch (it must be 0). It counts rows whose address is sealed,
 * which the fill cannot reach, as well as any the fill could not update.
 */
export async function countMissingContactHashes(
	client: Client,
	ring: Keyring,
	table: ContactTable,
): Promise<number> {
	const prefix = `${contactHashTag(ring, table)}:`;
	const [row] =
		table === "shadow_profile"
			? await client.$queryRaw<{ missing: bigint }[]>`
				SELECT count(*) AS "missing" FROM "shadow_profile"
				WHERE "email" IS NOT NULL
				  AND ("emailHash" IS NULL OR NOT starts_with("emailHash", ${prefix}))`
			: await client.$queryRaw<{ missing: bigint }[]>`
				SELECT count(*) AS "missing" FROM "guest_session"
				WHERE "emailHash" IS NULL OR NOT starts_with("emailHash", ${prefix})`;
	return Number(row?.missing ?? 0);
}
