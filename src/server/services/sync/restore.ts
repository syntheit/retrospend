/**
 * The restore check run at every start (E2EE lane P, P14a). A database
 * restored into another cluster or database, or a table restored from a dump,
 * leaves stamps whose txids this cluster has not reached, and cursors that
 * point into a log that no longer exists. sync_restore_reason() names what it
 * sees (a moved database oid, a moved table oid, a stamp at or above the next
 * transaction id); any answer runs sync_reset(): a new epoch, a floor at the
 * next transaction id, and a fresh log of every row. Devices holding an older
 * cursor get a reset answer and pull again.
 *
 * Owner connection only: sync_reset() locks the log and the app role cannot
 * run it.
 */
import { db } from "~/server/db";
import type { Prisma } from "~prisma";

type Runner = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SyncRestoreResult =
	| { restored: false }
	| { restored: true; reason: string; stamps: number };

export async function checkSyncRestore(
	client: Runner = db,
): Promise<SyncRestoreResult> {
	const [check] = await client.$queryRaw<
		{ reason: string | null }[]
	>`SELECT sync_restore_reason() AS "reason"`;
	if (!check?.reason) return { restored: false };
	const [reset] = await client.$queryRaw<
		{ stamps: number }[]
	>`SELECT sync_reset()::int AS "stamps"`;
	const result = {
		restored: true,
		reason: check.reason,
		stamps: reset?.stamps ?? 0,
	} as const;
	console.warn(
		`Sync log rebuilt after a restore (${result.reason}): ${result.stamps} stamps`,
	);
	return result;
}
