/**
 * The restore check run at every start (E2EE lane P, P14a). A database
 * restored into another cluster or database, a table restored from a dump, or
 * a snapshot or point-in-time restore in place leaves stamps whose txids this
 * cluster has not reached (or a counter that moved backwards), and cursors
 * that point into a log that no longer exists. sync_restore_reason() names what
 * it sees: a moved database oid, a moved table oid, a next transaction id below
 * the highest one seen ("rewind"), or a stamp at or above the next transaction
 * id. Any answer runs sync_reset(): a new epoch and a fresh log of every row.
 * Devices holding an older cursor get a reset answer and pull again. When
 * nothing is wrong, the highest next transaction id seen is raised, which is
 * what makes a later rewind visible.
 *
 * sync_reset() takes a lock on the log that every write to a synced table
 * waits on, and gives up after `lockWait` (30 s): the start then fails with
 * SyncResetLockTimeoutError and a log line, never a silent hang. Owner
 * connection only: the app role cannot run any of these functions.
 */
import { db } from "~/server/db";
import type { Prisma } from "~prisma";

type Runner = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export type SyncRestoreResult =
	| { restored: false }
	| { restored: true; reason: string; stamps: number };

export const SYNC_RESET_LOCK_TIMEOUT = "sync_reset_lock_timeout";

export class SyncResetLockTimeoutError extends Error {
	readonly code = SYNC_RESET_LOCK_TIMEOUT;
	constructor() {
		super(
			`${SYNC_RESET_LOCK_TIMEOUT}: the sync log is locked by another connection; start again once it is released`,
		);
		this.name = "SyncResetLockTimeoutError";
	}
}

/** Postgres lock_not_available (55P03), however the driver words it. */
function isLockTimeout(error: unknown): boolean {
	const meta = (error as { meta?: unknown } | null)?.meta;
	const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify(meta ?? "")}`;
	return /55P03|lock timeout/i.test(text);
}

export async function checkSyncRestore(
	client: Runner = db,
	lockWait = "30s",
): Promise<SyncRestoreResult> {
	const [check] = await client.$queryRaw<
		{ reason: string | null }[]
	>`SELECT sync_restore_reason() AS "reason"`;
	if (!check?.reason) {
		await client.$executeRaw`SELECT sync_note_xmax()`;
		return { restored: false };
	}
	let stamps = 0;
	try {
		const [reset] = await client.$queryRaw<
			{ stamps: number }[]
		>`SELECT sync_reset(${lockWait})::int AS "stamps"`;
		stamps = reset?.stamps ?? 0;
	} catch (error) {
		if (!isLockTimeout(error)) throw error;
		console.error(
			`${SYNC_RESET_LOCK_TIMEOUT}: a restore was found (${check.reason}) but the sync log is locked; the start fails`,
		);
		throw new SyncResetLockTimeoutError();
	}
	console.warn(
		`Sync log rebuilt after a restore (${check.reason}): ${stamps} stamps`,
	);
	return { restored: true, reason: check.reason, stamps };
}
