/**
 * The sync migration's catalog on real Postgres (E2EE lane P, P14a): which
 * tables carry the stamp trigger and which user tables do not (and why), the
 * backfill, sync_reset() and the restore detection at start, what the app
 * role may and may not do, and the rollback snippet. Anything that replays
 * SQL does it inside a transaction that always rolls back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { readSchema } from "~/test/prisma-schema";
import {
	inRolledBackPrismaTransaction,
	inRolledBackTransaction,
} from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { SYNCED_ENTITIES } from "./entities";
import { checkSyncRestore } from "./restore";
import { seedPersonal, stampsOf } from "./sync-test-support";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261114100000_sync_change";

// A worker's database is a clone of the template, so its oid differs from the
// one the migration stored; a start runs this check, so the test does too.
beforeAll(async () => {
	await checkSyncRestore();
});

/** Every Prisma model with a userId that is not a synced table, and why not. */
const NOT_SYNCED: Record<string, string> = {
	session: "sign-in state, never on a device",
	account: "sign-in providers, never on a device",
	budget: "legacy budget, read whole, not as a delta (plan section 2)",
	budget_member: "legacy budget sharing, shared data",
	exchange_rate_favorite: "UI preference, re-read whole",
	needs_you_snooze: "derived, the device rebuilds it",
	user_page_setting: "UI preference, re-read whole",
	analytics_category_preference: "UI preference, re-read whole",
	twoFactor: "sign-in state, never on a device",
	event_log: "audit trail, server only",
	import_job: "server-side job state with the uploaded file",
	ai_usage: "server accounting",
	payment_method: "settings, re-read whole",
	notification: "server inbox, fed by the events feed",
	notification_preference: "settings, re-read whole",
	username_history: "server only",
	feedback: "support data, server only",
	admin_access_log: "audit trail, server only",
	error_report: "support data, server only",
	device_code: "sign-in state, never on a device",
	idempotency_key: "server only",
	export_job: "server only",
	push_device: "server only",
	api_event: "the events feed, a wake-up signal rather than rows",
	webhook: "server only",
	webhook_delivery: "server only",
	push_delivery: "server only",
	sync_change: "the log itself",
};

const SYNC_TRIGGERS = `
	SELECT c.relname AS "table", t.tgname AS "name", t.tgtype AS "type",
	       replace(encode(t.tgargs, 'escape'), '\\000', '') AS "args",
	       t.tgenabled::text AS "enabled"
	FROM pg_trigger t
	JOIN pg_class c ON c.oid = t.tgrelid
	JOIN pg_proc p ON p.oid = t.tgfoid
	WHERE p.proname = 'sync_stamp_rows' AND NOT t.tgisinternal
	ORDER BY c.relname, t.tgname`;

type TriggerRow = {
	table: string;
	name: string;
	type: number;
	args: string;
	enabled: string;
};

describe("trigger coverage", () => {
	it("every synced table has exactly its three statement triggers, after the write, named for the entity", async () => {
		const rows = await adminDb.$queryRawUnsafe<TriggerRow[]>(SYNC_TRIGGERS);
		const byTable = new Map<string, TriggerRow[]>();
		for (const r of rows)
			byTable.set(r.table, [...(byTable.get(r.table) ?? []), r]);
		// Exactly the constant's tables: none missing, none extra.
		expect([...byTable.keys()].sort()).toEqual([...SYNCED_ENTITIES].sort());
		for (const entity of SYNCED_ENTITIES) {
			const triggers = byTable.get(entity) ?? [];
			expect(triggers.map((t) => t.name).sort()).toEqual(
				[
					`sync_${entity}_del`,
					`sync_${entity}_ins`,
					`sync_${entity}_upd`,
				].sort(),
			);
			for (const t of triggers) {
				expect(t.args).toBe(entity);
				// tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
				expect(t.type & 1).toBe(0);
				expect(t.type & 2).toBe(0);
				expect(t.enabled).toBe("O");
			}
			expect(triggers.map((t) => t.type & 28).sort((x, y) => x - y)).toEqual([
				4, 8, 16,
			]);
		}
	});

	it("the Prisma models with a userId are the synced tables or have a stated reason not to be", () => {
		const models = readSchema().filter((m) =>
			m.fields.some((f) => f.name === "userId"),
		);
		const tables = models.map((m) => m.table);
		const unclassified = tables.filter(
			(t) =>
				!(SYNCED_ENTITIES as readonly string[]).includes(t) &&
				!(t in NOT_SYNCED),
		);
		expect(unclassified).toEqual([]);
		// No stale entry in either list.
		expect(Object.keys(NOT_SYNCED).filter((t) => !tables.includes(t))).toEqual(
			[],
		);
		expect(SYNCED_ENTITIES.filter((t) => !tables.includes(t))).toEqual([]);
		expect(
			Object.entries(NOT_SYNCED).filter(([, why]) => why.length === 0),
		).toEqual([]);
	});
});

describe("backfill", () => {
	it("stamps every existing row once and a second run writes nothing", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		const before = await stampsOf(user.id);
		expect(before.length).toBeGreaterThanOrEqual(10);
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`DELETE FROM "sync_change" WHERE "userId" = ${user.id}`;
			const [first] = await tx.$queryRaw<
				{ n: number }[]
			>`SELECT sync_backfill()::int AS "n"`;
			// The deleted ones, no more: other users' stamps were kept.
			expect(first?.n).toBe(before.length);
			const after = await tx.$queryRaw<{ n: number; ops: string }[]>`
				SELECT count(*)::int AS "n", string_agg(DISTINCT "op", ',') AS "ops"
				FROM "sync_change" WHERE "userId" = ${user.id}`;
			expect(after[0]).toEqual({ n: before.length, ops: "U" });
			const [second] = await tx.$queryRaw<
				{ n: number }[]
			>`SELECT sync_backfill()::int AS "n"`;
			expect(second?.n).toBe(0);
		});
		expect(s.expense).toBeTruthy();
	});

	it("leaves an existing stamp alone, including a tombstone", async () => {
		const { user } = await createTestUser();
		const s = await seedPersonal(user.id);
		await adminDb.expense.delete({ where: { id: s.expense } });
		const [tomb] = await stampsOf(user.id, "expense");
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$queryRaw`SELECT sync_backfill()`;
			const rows = await tx.$queryRaw<{ op: string; seq: string }[]>`
				SELECT "op", "seq"::text AS "seq" FROM "sync_change"
				WHERE "entity" = 'expense' AND "entityId" = ${s.expense}`;
			expect(rows).toEqual([{ op: "D", seq: tomb?.seq }]);
		});
	});
});

describe("sync_reset and the restore check", () => {
	const state = (tx: { $queryRaw: typeof adminDb.$queryRaw }) =>
		tx.$queryRaw<{ epoch: string; floor: string; xmax: string }[]>`
			SELECT "epoch", "floorTxid"::text AS "floor",
			       pg_snapshot_xmax(pg_current_snapshot())::text AS "xmax"
			FROM "sync_state"`;

	it("sync_reset takes a new epoch, a floor back at 0 and a fresh log, under an exclusive lock", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		await inRolledBackPrismaTransaction(async (tx) => {
			const [before] = await state(tx);
			// A stamp from a cluster this one has not reached.
			await tx.$executeRaw`
				UPDATE "sync_change" SET "txid" = ((pg_snapshot_xmax(pg_current_snapshot())::text::bigint) + 5000000)::text::xid8
				WHERE "userId" = ${user.id} AND "entity" = 'category'`;
			const [reset] = await tx.$queryRaw<
				{ n: number }[]
			>`SELECT sync_reset()::int AS "n"`;
			const [after] = await state(tx);
			expect(after?.epoch).not.toBe(before?.epoch);
			// The epoch refuses every old cursor, so the floor has no work left and
			// must not sit above the txid of the reset's own stamps.
			expect(after?.floor).toBe("0");
			expect(before?.floor).not.toBeUndefined();
			// One stamp per live row of the nine tables and of the personal books' twelve, all U, none above the next txid.
			const [live] = await tx.$queryRaw<{ n: number }[]>`
				SELECT (
				  (SELECT count(*) FROM "expense" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "category" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "recurring_template" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "asset_account" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "asset_snapshot" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "asset_history" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "account_leg" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "transfer" r JOIN "user" u ON u.id = r."userId") +
				  (SELECT count(*) FROM "asset_rate_type" r JOIN "user" u ON u.id = r."userId")
				  + (SELECT count(*) FROM "envelope_group" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "envelope" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "envelope_category" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "budget_movement" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "book_period" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "month_close" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "income_rule" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "payoff_plan" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "wealth_transfer" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "envelope_change" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "income_rule_run" r WHERE sync_book_owner(r."bookId") IS NOT NULL)
				  + (SELECT count(*) FROM "budget_book" r WHERE sync_book_owner(r."id") IS NOT NULL)
				)::int AS "n"`;
			expect(reset?.n).toBe(live?.n);
			const [log] = await tx.$queryRaw<{ n: number; ops: string }[]>`
				SELECT count(*)::int AS "n", string_agg(DISTINCT "op", ',') AS "ops"
				FROM "sync_change"`;
			expect(log).toEqual({ n: live?.n, ops: "U" });
			const [lock] = await tx.$queryRaw<{ mode: string }[]>`
				SELECT mode FROM pg_locks
				WHERE relation = '"sync_change"'::regclass AND pid = pg_backend_pid() AND mode = 'ExclusiveLock'`;
			expect(lock?.mode).toBe("ExclusiveLock");
			const [again] = await tx.$queryRaw<
				{ reason: string | null }[]
			>`SELECT sync_restore_reason() AS "reason"`;
			expect(again?.reason).toBeNull();
		});
	});

	it("a database that was not restored is not reset", async () => {
		const [row] = await adminDb.$queryRaw<
			{ reason: string | null }[]
		>`SELECT sync_restore_reason() AS "reason"`;
		expect(row?.reason).toBeNull();
		expect(await checkSyncRestore()).toEqual({ restored: false });
	});

	it("a moved database oid (restored into another database or cluster) resets at start", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`UPDATE "sync_state" SET "databaseOid" = "databaseOid" + 1`;
			const [row] = await tx.$queryRaw<
				{ reason: string }[]
			>`SELECT sync_restore_reason() AS "reason"`;
			expect(row?.reason).toBe("database");
			const [before] = await state(tx);
			const result = await checkSyncRestore(tx);
			expect(result).toMatchObject({ restored: true, reason: "database" });
			expect((await state(tx))[0]?.epoch).not.toBe(before?.epoch);
			expect(await checkSyncRestore(tx)).toEqual({ restored: false });
		});
	});

	it("a moved table oid (the table restored from a dump in this database) resets at start", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`UPDATE "sync_state" SET "stateOid" = "stateOid" + 1`;
			const result = await checkSyncRestore(tx);
			expect(result).toMatchObject({ restored: true, reason: "table" });
			expect(await checkSyncRestore(tx)).toEqual({ restored: false });
		});
	});

	it("a stamp at or above the next txid (a new cluster's counter restarted) resets at start", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`
				UPDATE "sync_change" SET "txid" = ((pg_snapshot_xmax(pg_current_snapshot())::text::bigint) + 1000)::text::xid8
				WHERE "userId" = ${user.id} AND "entity" = 'expense'`;
			const result = await checkSyncRestore(tx);
			expect(result).toMatchObject({ restored: true, reason: "txid" });
			// The rebuilt log has no stamp above the counter.
			const [row] = await tx.$queryRaw<{ n: number }[]>`
				SELECT count(*)::int AS "n" FROM "sync_change"
				WHERE "txid" >= pg_snapshot_xmax(pg_current_snapshot())
				  AND "txid" IS DISTINCT FROM pg_current_xact_id_if_assigned()`;
			expect(row?.n).toBe(0);
		});
	});

	it("a stamp of the running transaction is not 'the future'", async () => {
		await inRolledBackPrismaTransaction(async (tx) => {
			await tx.$executeRaw`SELECT sync_backfill()`;
			const [row] = await tx.$queryRaw<
				{ reason: string | null }[]
			>`SELECT sync_restore_reason() AS "reason"`;
			expect(row?.reason).toBeNull();
		});
	});
});

describe("what the app role may do", () => {
	const denied = /permission denied/;
	const asApp = (work: (c: import("pg").Client) => Promise<unknown>) =>
		inRolledBackTransaction(async (client) => {
			await client.query("SET LOCAL ROLE retrospend_app");
			await work(client);
		});

	it("reads its own stamps and the state row, and nothing more", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		await asApp(async (client) => {
			await client.query("SELECT set_config('app.current_user_id', $1, true)", [
				user.id,
			]);
			const own = await client.query(
				"SELECT count(*)::int AS n FROM sync_change",
			);
			expect(own.rows[0].n).toBeGreaterThanOrEqual(10);
			const st = await client.query(
				"SELECT count(*)::int AS n FROM sync_state",
			);
			expect(st.rows[0].n).toBe(1);
		});
		for (const sql of [
			`INSERT INTO sync_state ("id","stateOid","databaseOid") VALUES (2,1,1)`,
			`UPDATE sync_state SET "floorTxid" = '0'`,
			`DELETE FROM sync_state`,
			`UPDATE sync_change SET "op" = 'D'`,
			`DELETE FROM sync_change`,
			`SELECT sync_reset()`,
			`SELECT sync_backfill()`,
			`SELECT sync_restore_reason()`,
			`SELECT nextval('sync_change_seq')`,
		])
			await expect(asApp((client) => client.query(sql))).rejects.toThrow(
				denied,
			);
	});

	it("without a user id set reads no stamp", async () => {
		await asApp(async (client) => {
			const own = await client.query(
				"SELECT count(*)::int AS n FROM sync_change",
			);
			expect(own.rows[0].n).toBe(0);
		});
	});
});

describe("the rollback snippet", () => {
	const objects = async (client: import("pg").Client) => {
		const one = async (sql: string) =>
			(await client.query(sql)).rows[0].n as number;
		return {
			triggers: await one(`
				SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
				WHERE p.proname = 'sync_stamp_rows' AND NOT t.tgisinternal`),
			functions: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE pronamespace = 'public'::regnamespace
				  AND proname IN ('sync_stamp_rows','sync_backfill','sync_reset','sync_restore_reason')`),
			tables: await one(`
				SELECT count(*)::int AS n FROM pg_class
				WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
				  AND relname IN ('sync_change','sync_state')`),
			sequences: await one(`
				SELECT count(*)::int AS n FROM pg_class
				WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'
				  AND relname = 'sync_change_seq'`),
			appRead: await one(`
				SELECT count(*) FILTER (WHERE has_table_privilege('retrospend_app', c.oid, 'SELECT')
				                         AND NOT has_table_privilege('retrospend_app', c.oid, 'INSERT'))::int AS n
				FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
				  AND c.relname IN ('sync_change','sync_state')`),
		};
	};
	const whole = {
		triggers: 27,
		functions: 4,
		tables: 2,
		sequences: 1,
		appRead: 2,
	};
	const none = {
		triggers: 0,
		functions: 0,
		tables: 0,
		sequences: 0,
		appRead: 0,
	};

	it("takes every object away, twice, and the migration brings every one back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const record = async (client: import("pg").Client) =>
			(
				await client.query(
					`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1`,
					[NAME],
				)
			).rows[0].n as number;
		await inRolledBackTransaction(async (client) => {
			expect(await objects(client)).toEqual(whole);
			expect(await record(client)).toBe(1);
			await client.query(snippet);
			await client.query(snippet);
			expect(await objects(client)).toEqual(none);
			// So the next start applies it again (owner-upgrade.pg.test.ts runs that
			// through migrate deploy).
			expect(await record(client)).toBe(0);
			await client.query(migration);
			await client.query(migration);
			expect(await objects(client)).toEqual(whole);
		});
	}, 120_000);

	it("the migration's own stamps match the log of the migrated database", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		await inRolledBackTransaction(async (client) => {
			const live = (
				await client.query(
					`SELECT "entity","entityId","op" FROM sync_change WHERE "userId" = $1 ORDER BY 1,2`,
					[user.id],
				)
			).rows;
			await client.query(snippet);
			await client.query(migration);
			const rebuilt = (
				await client.query(
					`SELECT "entity","entityId","op" FROM sync_change WHERE "userId" = $1 ORDER BY 1,2`,
					[user.id],
				)
			).rows;
			// Rolling back and migrating again stamps every row as U: the same set.
			expect(rebuilt).toEqual(live);
		});
	}, 120_000);
});
