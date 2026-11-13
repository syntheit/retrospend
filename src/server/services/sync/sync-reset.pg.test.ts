/**
 * The restore check and sync_reset() under the conditions that hurt (E2EE lane
 * P, P14a): a transaction counter rewound by a snapshot or point-in-time
 * restore in place, the high mark that makes it visible, the index the check
 * uses, a reset that gives up instead of hanging behind a connection that
 * holds the log, and a reset that runs next to a writer in either order
 * without losing a stamp or deadlocking.
 */
import { Client } from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { inRolledBackPrismaTransaction } from "~/test/rolled-back-sql";
import {
	checkSyncRestore,
	SYNC_RESET_LOCK_TIMEOUT,
	SyncResetLockTimeoutError,
} from "./restore";
import { stampsOf } from "./sync-test-support";
import { sweepSyncTombstones } from "./tombstones";

// A worker's database is a clone of the template, so its oid differs from the
// one the migration stored; a start runs this check, so the test does too.
beforeAll(async () => {
	await checkSyncRestore();
});

const xmaxPlus = (n: number) =>
	`((pg_snapshot_xmax(pg_current_snapshot())::text::bigint) + ${n})::text::xid8`;

describe("a rewound transaction counter", () => {
	it("a next txid below the highest one seen (a snapshot or point-in-time restore in place) resets at start", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRawUnsafe(
				`UPDATE "sync_state" SET "highXmax" = ${xmaxPlus(1_000_000)}`,
			);
			const [row] = await tx.$queryRaw<
				{ reason: string }[]
			>`SELECT sync_restore_reason() AS "reason"`;
			expect(row?.reason).toBe("rewind");
			const result = await checkSyncRestore(tx);
			expect(result).toMatchObject({ restored: true, reason: "rewind" });
			// The reset took the counter's present as the new high mark.
			const [after] = await tx.$queryRaw<{ over: boolean }[]>`
				SELECT "highXmax" > pg_snapshot_xmax(pg_current_snapshot()) AS "over" FROM "sync_state"`;
			expect(after?.over).toBe(false);
			expect(await checkSyncRestore(tx)).toEqual({ restored: false });
		});
	});

	it("a clean check raises the high mark and never lowers it", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`UPDATE "sync_state" SET "highXmax" = '0'::xid8`;
			expect(await checkSyncRestore(tx)).toEqual({ restored: false });
			const [raised] = await tx.$queryRaw<{ ok: boolean }[]>`
				SELECT "highXmax" >= pg_snapshot_xmax(pg_current_snapshot()) AND "highXmax" > '0'::xid8 AS "ok"
				FROM "sync_state"`;
			expect(raised?.ok).toBe(true);
			await tx.$executeRawUnsafe(
				`UPDATE "sync_state" SET "highXmax" = ${xmaxPlus(7)}`,
			);
			const [before] = await tx.$queryRaw<
				{ high: string }[]
			>`SELECT "highXmax"::text AS "high" FROM "sync_state"`;
			await tx.$executeRaw`SELECT sync_note_xmax()`;
			const [after] = await tx.$queryRaw<
				{ high: string }[]
			>`SELECT "highXmax"::text AS "high" FROM "sync_state"`;
			expect(after?.high).toBe(before?.high);
		});
	});

	it("the hourly sweep raises the high mark too", async () => {
		await adminDb.$executeRaw`UPDATE "sync_state" SET "highXmax" = '0'::xid8`;
		await sweepSyncTombstones(new Date(), 90);
		const [row] = await adminDb.$queryRaw<{ ok: boolean }[]>`
			SELECT "highXmax" > '0'::xid8 AS "ok" FROM "sync_state"`;
		expect(row?.ok).toBe(true);
	});

	it("the check for a stamp above the counter has an index to use", async () => {
		const rows = await adminDb.$transaction(async (tx) => {
			await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
			return tx.$queryRaw<{ "QUERY PLAN": string }[]>`
				EXPLAIN SELECT 1 FROM "sync_change"
				WHERE "txid" >= pg_snapshot_xmax(pg_current_snapshot())`;
		});
		expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(
			"sync_change_txid_idx",
		);
	});
});

async function connect() {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	return client;
}

/** Polls until a session whose query matches `like` waits on a lock. */
async function waitsOnLock(like: string) {
	const stop = Date.now() + 10_000;
	for (;;) {
		const [row] = await adminDb.$queryRaw<{ n: number }[]>`
			SELECT count(*)::int AS "n" FROM pg_stat_activity
			WHERE wait_event_type = 'Lock' AND query LIKE ${like}
			  AND pid <> pg_backend_pid()`;
		if ((row?.n ?? 0) > 0) return;
		if (Date.now() > stop) throw new Error(`nothing waits on a lock: ${like}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

const insertExpense = (id: string, userId: string) =>
	[
		`INSERT INTO "expense" ("id","userId","title","amount","currency","date","amountInUSD","exchangeRate","pricingSource","updatedAt")
		 VALUES ($1, $2, 'Concurrent', 1, 'ARS', now(), 0.01, 1468, 'MANUAL', now())`,
		[id, userId],
	] as const;

const epoch = async () =>
	(
		await adminDb.$queryRaw<
			{ epoch: string }[]
		>`SELECT "epoch" FROM "sync_state"`
	)[0]?.epoch;

describe("a reset never hangs", () => {
	it("gives up after its wait when a connection holds the log, and changes nothing", async () => {
		const holder = await connect();
		try {
			await holder.query("BEGIN");
			await holder.query("LOCK TABLE sync_change IN ROW EXCLUSIVE MODE");
			const before = await epoch();
			await expect(
				adminDb.$queryRaw`SELECT sync_reset('300ms')`,
			).rejects.toThrow(/lock timeout|55P03/);
			expect(await epoch()).toBe(before);
		} finally {
			await holder.query("ROLLBACK");
			await holder.end();
		}
	});

	it("a start that finds a restore fails loudly with a code instead of waiting for ever", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await adminDb.$executeRaw`UPDATE "sync_state" SET "databaseOid" = "databaseOid" + 1`;
		const holder = await connect();
		try {
			await holder.query("BEGIN");
			await holder.query("LOCK TABLE sync_change IN ROW EXCLUSIVE MODE");
			const started = Date.now();
			const failure = await checkSyncRestore(adminDb, "300ms").catch(
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(SyncResetLockTimeoutError);
			expect((failure as SyncResetLockTimeoutError).code).toBe(
				SYNC_RESET_LOCK_TIMEOUT,
			);
			expect(Date.now() - started).toBeLessThan(10_000);
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining(SYNC_RESET_LOCK_TIMEOUT),
			);
		} finally {
			await holder.query("ROLLBACK");
			await holder.end();
			log.mockRestore();
			// The next start, with the log free, rebuilds it.
			expect(await checkSyncRestore()).toMatchObject({
				restored: true,
				reason: "database",
			});
		}
	});
});

describe("a reset next to a writer", () => {
	it("a writer inside its stamp trigger when the reset starts: the reset waits, then the row is stamped", async () => {
		const { user } = await createTestUser();
		const id = `concurrent-a-${user.id.slice(0, 8)}`;
		const writer = await connect();
		try {
			await writer.query("BEGIN");
			await writer.query(...insertExpense(id, user.id));
			const before = await epoch();
			// A Prisma query starts when it is awaited, so start it by hand.
			const reset = (async () =>
				adminDb.$queryRaw<
					{ n: number }[]
				>`SELECT sync_reset('20s')::int AS "n"`)();
			await waitsOnLock("%sync_reset%");
			await writer.query("COMMIT");
			const [done] = await reset;
			expect(done?.n).toBeGreaterThanOrEqual(1);
			expect(await epoch()).not.toBe(before);
			const stamps = await stampsOf(user.id, "expense");
			expect(stamps.map((s) => `${s.entityId}:${s.op}`)).toEqual([`${id}:U`]);
		} finally {
			await writer.query("ROLLBACK").catch(() => undefined);
			await writer.end();
			await adminDb.user.delete({ where: { id: user.id } });
		}
	}, 60_000);

	it("a reset holding the log when the writer reaches its trigger: the writer waits, then stamps after the reset", async () => {
		const { user } = await createTestUser();
		const id = `concurrent-b-${user.id.slice(0, 8)}`;
		const resetter = await connect();
		const writer = await connect();
		try {
			await resetter.query("BEGIN");
			await resetter.query("SELECT sync_reset('20s')");
			const insert = writer.query(...insertExpense(id, user.id));
			await waitsOnLock('%INSERT INTO "expense"%');
			await resetter.query("COMMIT");
			await insert;
			const stamps = await stampsOf(user.id, "expense");
			expect(stamps.map((s) => `${s.entityId}:${s.op}`)).toEqual([`${id}:U`]);
		} finally {
			await resetter.query("ROLLBACK").catch(() => undefined);
			await resetter.end();
			await writer.end();
			await adminDb.user.delete({ where: { id: user.id } });
		}
	}, 60_000);
});
