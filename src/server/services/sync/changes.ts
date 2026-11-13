/**
 * The reader of the delta log (E2EE lane P, P14a): the changes to one entity
 * of one user after a cursor, in commit order. Stamps come from "sync_change"
 * (ids only, written by the sync_stamp_rows trigger), the rows from the live
 * tables through the Prisma models (entities.ts), so a row is always as new
 * as the read and sealed text is opened by the client's own keys.
 *
 * Why no change is skipped: the cursor is (txid, seq), and a stamp is visible
 * only when its txid is below the oldest open transaction (the events feed's
 * cut, events/feed.ts), so a stamp that commits late is never behind a cursor
 * a client holds. The epoch, the tombstone floor and the cut come out of one
 * statement, one snapshot. A row that changes between the stamp read and the
 * row read comes back in its newer state, and its newer stamp is past the
 * cursor, so it comes again on a later page (a client applies rows by id, so
 * twice is the same as once). A row that is gone, or that left this owner,
 * reads as deleted: the stamp says U, the row is not there. An id is on one
 * list of a page, never both: one stamp per id and owner.
 *
 * The token is base64url JSON {e, t, s}: the epoch, the txid and the seq of
 * the last stamp returned. The last page of a pull (no more stamps) hands back
 * the position of the cut instead, (the oldest open transaction minus one, the
 * largest seq): everything below the cut was read and can only move up, and a
 * cursor at the last stamp itself could sit below the floor for ever, so a
 * client that is caught up would be sent back to the start on every pull. A
 * garbage token is a 400 (InvalidCursorError). A
 * token the log can no longer honor is SyncResetRequiredError (a 410 on the
 * route, P14b): another epoch (sync_reset), a txid this cluster has not
 * reached (a restore), or one at or below the floor (the sweep removed
 * tombstones it may not have seen). The client drops its rows of the entity
 * and pulls again from the start.
 */
import * as z from "zod";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { decodeCursor, encodeCursor } from "~/server/services/api-v1/cursor";
import { Prisma } from "~prisma";
import { SYNC_LOADERS, type SyncEntity, type SyncRow } from "./entities";

const syncCursorSchema = z.object({
	e: z.string().min(1).max(64),
	t: z.string().regex(/^\d{1,20}$/),
	s: z.string().regex(/^\d{1,20}$/),
});

export class SyncResetRequiredError extends Error {
	constructor() {
		super("The sync cursor is no longer valid; pull again from the start");
		this.name = "SyncResetRequiredError";
	}
}

export type Stamp = {
	id: string;
	op: "U" | "D";
	txid: string;
	seq: string;
	changedAt: Date;
};

export type StampRead = {
	epoch: string;
	stamps: Stamp[];
	/** More stamps follow `stamps`; `stamps` holds at most `limit` of them. */
	hasMore: boolean;
	/** The highest txid every stamp of is in this read or an earlier one. */
	cut: string;
};

const MAX_SEQ = "9223372036854775807";

export type SyncPage<Row> = {
	items: Row[];
	tombstones: { id: string; deletedAt: Date }[];
	cursor: string;
	hasMore: boolean;
};

type StampRow = {
	epoch: string;
	floor: string;
	xmin: string;
	xmax: string;
	entityId: string | null;
	op: string | null;
	txid: string | null;
	seq: string | null;
	changedAt: Date | null;
};

/**
 * The stamps of one entity for the caller after `since`, oldest first, at
 * most `limit`. Throws InvalidCursorError for a token that is not ours and
 * SyncResetRequiredError for one the log cannot honor. Run it in a user
 * transaction (userTransaction), so row-level security applies.
 */
export async function readStamps(
	tx: Prisma.TransactionClient,
	userId: string,
	entity: SyncEntity,
	query: { since?: string; limit: number },
): Promise<StampRead> {
	const after = decodeCursor(query.since, syncCursorSchema);
	const rows = await tx.$queryRaw<StampRow[]>(Prisma.sql`
		SELECT st."epoch", st."floorTxid"::text AS "floor",
		       pg_snapshot_xmin(pg_current_snapshot())::text AS "xmin",
		       pg_snapshot_xmax(pg_current_snapshot())::text AS "xmax",
		       c."entityId", c."op", c."txid"::text AS "txid", c."seq"::text AS "seq",
		       c."changedAt"
		FROM "sync_state" st
		LEFT JOIN LATERAL (
			SELECT "entityId", "op", "txid", "seq", "changedAt"
			FROM "sync_change"
			WHERE "userId" = ${userId} AND "entity" = ${entity}
			  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
			  ${
					after
						? Prisma.sql`AND ("txid", "seq") > (${after.t}::xid8, ${after.s}::bigint)`
						: Prisma.empty
				}
			ORDER BY "txid", "seq"
			LIMIT ${query.limit + 1}
		) c ON true
		WHERE st."id" = 1`);
	const state = rows[0];
	if (!state) throw new Error("sync_state has no row");
	if (after) {
		const t = BigInt(after.t);
		if (
			after.e !== state.epoch ||
			t <= BigInt(state.floor) ||
			t >= BigInt(state.xmax)
		) {
			throw new SyncResetRequiredError();
		}
	}
	const stamps: Stamp[] = [];
	for (const row of rows) {
		if (
			row.entityId === null ||
			row.op === null ||
			row.txid === null ||
			row.seq === null ||
			row.changedAt === null
		)
			continue;
		stamps.push({
			id: row.entityId,
			op: row.op === "D" ? "D" : "U",
			txid: row.txid,
			seq: row.seq,
			changedAt: row.changedAt,
		});
	}
	return {
		epoch: state.epoch,
		stamps: stamps.slice(0, query.limit),
		hasMore: stamps.length > query.limit,
		cut: (BigInt(state.xmin) - 1n).toString(),
	};
}

/**
 * Turns a stamp read into a page: the live rows of the U stamps (loaded by id
 * and owner), a tombstone for a D stamp and for a U stamp whose row is not
 * there. Items and tombstones keep stamp order.
 */
export async function loadPage<E extends SyncEntity>(
	tx: Prisma.TransactionClient,
	userId: string,
	entity: E,
	read: StampRead,
): Promise<SyncPage<SyncRow<E>>> {
	const wanted = read.stamps.filter((s) => s.op === "U").map((s) => s.id);
	// One union of loaders cannot be called with a generic key; each returns
	// the rows of its own entity, which SyncRow<E> names.
	const load = SYNC_LOADERS[entity] as unknown as (
		tx: Prisma.TransactionClient,
		ids: string[],
		userId: string,
	) => Promise<SyncRow<E>[]>;
	const rows = wanted.length > 0 ? await load(tx, wanted, userId) : [];
	const byId = new Map(rows.map((row) => [row.id, row]));
	const items: SyncRow<E>[] = [];
	const tombstones: { id: string; deletedAt: Date }[] = [];
	for (const stamp of read.stamps) {
		const row = stamp.op === "U" ? byId.get(stamp.id) : undefined;
		if (row) items.push(row);
		else tombstones.push({ id: stamp.id, deletedAt: stamp.changedAt });
	}
	const last = read.stamps.at(-1);
	const position =
		read.hasMore && last
			? { t: last.txid, s: last.seq }
			: { t: read.cut, s: MAX_SEQ };
	return {
		items,
		tombstones,
		cursor: encodeCursor({ e: read.epoch, ...position }),
		hasMore: read.hasMore,
	};
}

/** One page of changes to `entity` for `userId` after `since`. */
export async function readChanges<E extends SyncEntity>(
	db: typeof globalDb,
	userId: string,
	entity: E,
	query: { since?: string; limit: number },
): Promise<SyncPage<SyncRow<E>>> {
	return userTransaction(db, userId, async (tx) =>
		loadPage(tx, userId, entity, await readStamps(tx, userId, entity, query)),
	);
}
