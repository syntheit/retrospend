/**
 * The hourly sweep of sync tombstones (E2EE lane P, P14a), on the owner
 * connection over all users, called from sweepSupportData. A D stamp older
 * than SYNC_TOMBSTONE_DAYS is deleted, and the floor in "sync_state" rises to
 * the highest txid removed, in the same statement: a cursor at or below the
 * floor may have missed a deletion, and the reader answers it with a reset
 * (changes.ts). Live (U) stamps are never swept. A stamp that turned into a U
 * between the pick and the delete (the row came back) is left alone.
 */
import { env } from "~/env";
import { db } from "~/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

export async function sweepSyncTombstones(
	now = new Date(),
	days = env.SYNC_TOMBSTONE_DAYS,
): Promise<number> {
	const cutoff = new Date(now.getTime() - days * DAY_MS);
	let removed = 0;
	for (;;) {
		const [row] = await db.$queryRaw<{ removed: number }[]>`
			WITH picked AS (
				SELECT "entity", "entityId", "userId" FROM "sync_change"
				WHERE "op" = 'D' AND "changedAt" < ${cutoff}
				ORDER BY "changedAt"
				LIMIT ${BATCH}
			), gone AS (
				DELETE FROM "sync_change" s
				USING picked p
				WHERE s."entity" = p."entity" AND s."entityId" = p."entityId"
				  AND s."userId" = p."userId" AND s."op" = 'D'
				RETURNING s."txid"
			), raised AS (
				UPDATE "sync_state"
				SET "floorTxid" = GREATEST("floorTxid", (SELECT "txid" FROM gone ORDER BY "txid" DESC LIMIT 1))
				WHERE "id" = 1 AND EXISTS (SELECT 1 FROM gone)
				RETURNING 1
			)
			SELECT (SELECT count(*) FROM gone)::int AS "removed"`;
		const count = row?.removed ?? 0;
		removed += count;
		if (count < BATCH) break;
	}
	return removed;
}
