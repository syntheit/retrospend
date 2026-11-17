/**
 * The sealed record store (E2EE F7a, docs/roadmap/e2ee-f7a.md): a protected
 * account's records, stored and returned but never opened. The server holds
 * the bytes a client sealed and the plain facts around them (id, collection,
 * entity number, version, write times) and never logs either. Both functions
 * run in the caller's transaction (userTransaction), so row-level security
 * applies. A batch is all or nothing on its own (a savepoint), so a caller
 * that catches the error and commits keeps none of it.
 *
 * Order is the device sync feed's (sync/changes.ts): the vault_record_stamp
 * trigger sets (txid, seq) on every write, and a reader only sees rows whose
 * txid is below the oldest open transaction, so a write that commits late is
 * never behind a cursor a client holds. A rewritten record moves to the end
 * and comes again at its new version.
 */
import * as z from "zod";
import { Prisma } from "~prisma";
import { decodeCursor, encodeCursor } from "../api-v1/cursor";
import { SyncResetRequiredError, syncCursorSchema } from "../sync/changes";
import { VaultError } from "./errors";
import { type VaultWrite, validateVaultWrites } from "./validate";

export { VaultError } from "./errors";
export type { VaultWrite } from "./validate";

/**
 * The sync feed's cursor plus a kind, so a cursor of one feed is refused by
 * the other (syncCursorSchema is strict, this one needs `k`) instead of
 * skipping rows. Nothing wrote a vault cursor before K9, so there is no
 * kind-less form to keep working.
 */
const vaultCursorSchema = z.strictObject({
	...syncCursorSchema.shape,
	k: z.literal("vault"),
});

const MAX_SEQ = (2n ** 63n - 1n).toString();
/** A page stops after about this much ciphertext (always at least one row). */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PAGE_ROWS = 1000;

/** A copy that is a plain Uint8Array, whether the driver hands back a Buffer or not. */
const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
	Uint8Array.from(bytes);

type Existing = {
	collectionId: string;
	entity: number;
	version: number;
	same: boolean;
};

/** Writes one record; true when this call changed a row. */
async function writeOne(
	tx: Prisma.TransactionClient,
	userId: string,
	w: VaultWrite,
): Promise<boolean> {
	const bytes = w.ciphertext === null ? null : Buffer.from(w.ciphertext);
	if (w.baseVersion === 0) {
		// DO NOTHING (not a unique violation) so a taken id does not abort the
		// transaction: the batch's conflicts are gathered, then reported once.
		const rows = await tx.$queryRaw<{ id: string }[]>`
			INSERT INTO "vault_record" ("userId", "id", "collectionId", "entity", "version", "ciphertext")
			VALUES (${userId}, ${w.id}, ${w.collectionId}, ${w.entity}, 1, ${bytes}::bytea)
			ON CONFLICT ("userId", "id") DO NOTHING
			RETURNING "id"`;
		return rows.length === 1;
	}
	// A tombstone keeps no ciphertext; a live write over one revives it.
	const deletedAt =
		bytes === null ? Prisma.sql`CURRENT_TIMESTAMP` : Prisma.sql`NULL`;
	const rows = await tx.$queryRaw<{ id: string }[]>`
		UPDATE "vault_record"
		SET "ciphertext" = ${bytes}::bytea, "version" = ${w.baseVersion + 1}, "deletedAt" = ${deletedAt}
		WHERE "userId" = ${userId} AND "id" = ${w.id} AND "version" = ${w.baseVersion}
		  AND "collectionId" = ${w.collectionId} AND "entity" = ${w.entity}
		RETURNING "id"`;
	return rows.length === 1;
}

/**
 * Why a write changed nothing: `replay` when the stored row is exactly what
 * this write would have made (a batch whose answer was lost, sent again),
 * `moved` when the record lives under another collection or entity (a record
 * never moves: tombstone it and use a new id), else `conflict`. The bytes are
 * compared in the database, never read back.
 */
async function whyNot(
	tx: Prisma.TransactionClient,
	userId: string,
	w: VaultWrite,
): Promise<"replay" | "moved" | "conflict"> {
	const bytes = w.ciphertext === null ? null : Buffer.from(w.ciphertext);
	const rows = await tx.$queryRaw<Existing[]>`
		SELECT "collectionId", "entity", "version",
		       ("ciphertext" IS NOT DISTINCT FROM ${bytes}::bytea) AS "same"
		FROM "vault_record" WHERE "userId" = ${userId} AND "id" = ${w.id}`;
	const row = rows[0];
	if (!row) return "conflict";
	if (row.collectionId !== w.collectionId || row.entity !== w.entity)
		return "moved";
	return row.version === w.baseVersion + 1 && row.same ? "replay" : "conflict";
}

/**
 * Applies up to 500 writes, all or nothing. A write names the version it read
 * (`baseVersion`, 0 creates) and becomes `baseVersion + 1`, the version its
 * client sealed it for (the AAD binds it). A write whose base is stale, or
 * whose id is already taken, is a `conflict`; every conflicting id is listed
 * in one error after the whole batch was tried. A write already applied
 * (same version, same bytes) returns its result again instead of conflicting,
 * so a retried batch is safe. Writes run in id order so two batches over the
 * same records take their row locks in one order. Returns `{ id, version }`
 * per write, in the order given.
 */
export async function applyVaultWrites(
	tx: Prisma.TransactionClient,
	userId: string,
	writes: readonly VaultWrite[],
): Promise<{ id: string; version: number }[]> {
	validateVaultWrites(writes);
	// All or nothing without relying on the caller: a caller that catches the
	// error inside its own transaction and commits must not keep the writes
	// that came before the conflict.
	await tx.$executeRaw`SAVEPOINT vault_writes`;
	try {
		const conflicts: string[] = [];
		const ordered = [...writes].sort((a, b) => (a.id < b.id ? -1 : 1));
		for (const w of ordered) {
			if (await writeOne(tx, userId, w)) continue;
			const why = await whyNot(tx, userId, w);
			if (why === "moved") throw new VaultError("invalid_input");
			if (why === "conflict") conflicts.push(w.id);
		}
		if (conflicts.length > 0) throw new VaultError("conflict", conflicts);
	} catch (error) {
		await tx.$executeRaw`ROLLBACK TO SAVEPOINT vault_writes`;
		throw error;
	}
	await tx.$executeRaw`RELEASE SAVEPOINT vault_writes`;
	return writes.map((w) => ({ id: w.id, version: w.baseVersion + 1 }));
}

export type VaultRecord = {
	id: string;
	collectionId: string;
	entity: number;
	version: number;
	/** Null for a tombstone. */
	ciphertext: Uint8Array | null;
	deletedAt: Date | null;
};

export type VaultPage = {
	records: VaultRecord[];
	/** Pass it back as `cursor`. At the last page it is the cut, so a caught-up client is not sent to the start. */
	cursor: string;
	hasMore: boolean;
};

type PageRow = {
	epoch: string;
	xmin: string;
	xmax: string;
	id: string | null;
	collectionId: string | null;
	entity: number | null;
	version: number | null;
	deletedAt: Date | null;
	txid: string | null;
	seq: string | null;
	included: boolean | null;
	ciphertext: Uint8Array | null;
};

/**
 * One page of records (live and tombstones) after `cursor`, in commit order,
 * under the snapshot's cut. At most `limit` (1 to 1000) rows and about
 * `maxBytes` of ciphertext, always at least one row. Throws InvalidCursorError
 * for a token that is not ours and SyncResetRequiredError for one the store
 * can no longer honor: another epoch (sync_reset, a restore) or a txid this
 * cluster has not reached. The caller drops its copy and pulls from the start.
 * One statement, so the epoch, the cut and the rows are one snapshot, and a
 * row rewritten while paging shows its old version now and its new one on a
 * later page.
 */
export async function readVaultChanges(
	tx: Prisma.TransactionClient,
	userId: string,
	cursor: string | undefined,
	options: { limit: number; maxBytes?: number },
): Promise<VaultPage> {
	const { limit, maxBytes = MAX_PAGE_BYTES } = options;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS)
		throw new VaultError("invalid_input");
	// The first row is always in because the bytes before it are 0, which is
	// under any positive cap; a cap of zero or less would drop it.
	if (!Number.isInteger(maxBytes) || maxBytes < 1)
		throw new VaultError("invalid_input");
	const after = decodeCursor(cursor, vaultCursorSchema);
	const rows = await tx.$queryRaw<PageRow[]>(Prisma.sql`
		WITH st AS (
			SELECT "epoch", pg_snapshot_xmin(pg_current_snapshot()) AS "xmin",
			       pg_snapshot_xmax(pg_current_snapshot()) AS "xmax"
			FROM "sync_state" WHERE "id" = 1
		), cand AS (
			SELECT v."id", v."collectionId", v."entity", v."version", v."deletedAt", v."txid", v."seq",
			       coalesce(octet_length(v."ciphertext"), 0) AS "size"
			FROM "vault_record" v, st
			WHERE v."userId" = ${userId} AND v."txid" < st."xmin"
			  ${
					after
						? Prisma.sql`AND (v."txid", v."seq") > (${after.t}::xid8, ${after.s}::bigint)`
						: Prisma.empty
				}
			ORDER BY v."txid", v."seq"
			LIMIT ${limit + 1}
		), flagged AS (
			SELECT cand.*,
			       (row_number() OVER w <= ${limit}
			        AND coalesce(sum(cand."size") OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) < ${maxBytes}
			       ) AS "included"
			FROM cand
			WINDOW w AS (ORDER BY cand."txid", cand."seq")
		)
		SELECT st."epoch", st."xmin"::text AS "xmin", st."xmax"::text AS "xmax",
		       f."id", f."collectionId", f."entity", f."version", f."deletedAt",
		       f."txid"::text AS "txid", f."seq"::text AS "seq", f."included",
		       CASE WHEN f."included" THEN (
		         SELECT r."ciphertext" FROM "vault_record" r
		         WHERE r."userId" = ${userId} AND r."id" = f."id"
		       ) END AS "ciphertext"
		FROM st LEFT JOIN flagged f ON true
		ORDER BY f."txid", f."seq"`);
	const state = rows[0];
	if (!state) throw new Error("sync_state has no row");
	if (
		after &&
		(after.e !== state.epoch || BigInt(after.t) >= BigInt(state.xmax))
	) {
		throw new SyncResetRequiredError();
	}
	const records: VaultRecord[] = [];
	let last: { t: string; s: string } | undefined;
	let hasMore = false;
	for (const row of rows) {
		if (row.id === null) continue;
		if (!row.included) {
			hasMore = true;
			continue;
		}
		records.push({
			id: row.id,
			collectionId: row.collectionId as string,
			entity: row.entity as number,
			version: row.version as number,
			ciphertext: row.ciphertext === null ? null : plain(row.ciphertext),
			deletedAt: row.deletedAt,
		});
		last = { t: row.txid as string, s: row.seq as string };
	}
	// Caught up: everything below the cut was read and can only move up, so the
	// cut is the position, as the sync feed does.
	const position =
		hasMore && last
			? last
			: { t: (BigInt(state.xmin) - 1n).toString(), s: MAX_SEQ };
	return {
		records,
		cursor: encodeCursor({ k: "vault", e: state.epoch, ...position }),
		hasMore,
	};
}
