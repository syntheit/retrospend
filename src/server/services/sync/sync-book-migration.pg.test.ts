/**
 * The book family migration's rollback snippet and its privileges on real
 * Postgres (E2EE lane P, P14c). Anything that replays SQL does it inside a
 * transaction that always rolls back. The stamps, the backfill and the
 * trigger catalog are in sync-book-stamps.pg.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { SYNCED_BOOK_ENTITIES } from "./book-entities";
import { seedBook } from "./sync-book-test-support";
import { seedPersonal } from "./sync-test-support";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261114200000_sync_book_family";

const FAMILY = SYNCED_BOOK_ENTITIES.map((e) => `'${e}'`).join(",");

describe("what the app role may do with the book family's functions", () => {
	const denied = /permission denied/;
	const asApp = (work: (c: Client) => Promise<unknown>) =>
		inRolledBackTransaction(async (client) => {
			await client.query("SET LOCAL ROLE retrospend_app");
			await work(client);
		});

	it("cannot call them, so it cannot stamp, hand over or read an owner out", async () => {
		for (const sql of [
			`SELECT sync_book_owner('x')`,
			`SELECT * FROM sync_book_tables()`,
			`SELECT sync_book_stamp('x', 'y', 'D')`,
			`SELECT sync_backfill()`,
		])
			await expect(asApp((client) => client.query(sql))).rejects.toThrow(
				denied,
			);
	});

	it("cannot write a stamp of the family, and reads only its own", async () => {
		const { user } = await createTestUser();
		await seedBook(user.id);
		await asApp(async (client) => {
			await client.query("SELECT set_config('app.current_user_id', $1, true)", [
				user.id,
			]);
			const own = await client.query(
				`SELECT count(*)::int AS n FROM sync_change WHERE entity IN (${FAMILY})`,
			);
			expect(own.rows[0].n).toBe(13);
			const others = await client.query(
				`SELECT count(*)::int AS n FROM sync_change WHERE "userId" <> $1`,
				[user.id],
			);
			expect(others.rows[0].n).toBe(0);
		});
		await expect(
			asApp((client) =>
				client.query(
					`INSERT INTO sync_change ("entity","entityId","userId","op","seq") VALUES ('envelope','x','y','D',1)`,
				),
			),
		).rejects.toThrow(denied);
	});
});

describe("the rollback snippet", () => {
	const objects = async (client: Client) => {
		const one = async (sql: string) =>
			(await client.query(sql)).rows[0].n as number;
		return {
			triggers: await one(`
				SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
				WHERE p.proname IN ('sync_stamp_book_rows','sync_stamp_book_self','sync_stamp_book_members')
				  AND NOT t.tgisinternal`),
			functions: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE pronamespace = 'public'::regnamespace
				  AND proname IN ('sync_stamp_book_rows','sync_stamp_book_self','sync_stamp_book_members',
				                  'sync_book_stamp','sync_book_tables','sync_book_owner')`),
			// The version of the backfill that stamps the family.
			backfillStampsBooks: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE proname = 'sync_backfill' AND pronamespace = 'public'::regnamespace
				  AND prosrc LIKE '%sync_book_tables%'`),
			backfills: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE proname = 'sync_backfill' AND pronamespace = 'public'::regnamespace`),
		};
	};
	const whole = {
		// 11 child tables and the book, budget_member: three each.
		triggers: 39,
		functions: 6,
		backfillStampsBooks: 1,
		backfills: 1,
	};
	const none = {
		triggers: 0,
		functions: 0,
		backfillStampsBooks: 0,
		backfills: 1,
	};

	it("takes the family away, twice, keeps the older log, and the migration brings it back, twice", async () => {
		const { user } = await createTestUser();
		await seedPersonal(user.id);
		await seedBook(user.id);
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const record = async (client: Client) =>
			(
				await client.query(
					`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1`,
					[NAME],
				)
			).rows[0].n as number;
		const stamps = async (client: Client, inFamily: boolean) =>
			(
				await client.query(
					`SELECT count(*)::int AS n FROM sync_change
					 WHERE "userId" = $1 AND (entity IN (${FAMILY})) = $2`,
					[user.id, inFamily],
				)
			).rows[0].n as number;
		await inRolledBackTransaction(async (client) => {
			expect(await objects(client)).toEqual(whole);
			expect(await record(client)).toBe(1);
			const nine = await stamps(client, false);
			expect(nine).toBeGreaterThanOrEqual(10);
			expect(await stamps(client, true)).toBe(13);

			await client.query(snippet);
			await client.query(snippet);
			expect(await objects(client)).toEqual(none);
			// So the next start applies it again (owner-upgrade.pg.test.ts runs
			// that through migrate deploy).
			expect(await record(client)).toBe(0);
			// The older migration's log is as it was; the family's stamps are gone.
			expect(await stamps(client, false)).toBe(nine);
			expect(await stamps(client, true)).toBe(0);

			await client.query(migration);
			await client.query(migration);
			expect(await objects(client)).toEqual(whole);
			// The backfill in the migration stamped the book again, as U.
			expect(await stamps(client, true)).toBe(13);
			expect(await stamps(client, false)).toBe(nine);
		});
	}, 120_000);

	it("a book written after the snippet is not stamped, and is stamped by the migration's backfill", async () => {
		const { user } = await createTestUser();
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			await client.query(
				`INSERT INTO budget_book ("id","name","currency","startDate","startMonth","createdById","updatedAt")
				 VALUES ('book-after-rollback','Home','ARS', now(), 202611, $1, now())`,
				[user.id],
			);
			const quiet = await client.query(
				`SELECT count(*)::int AS n FROM sync_change WHERE entity = 'budget_book' AND "userId" = $1`,
				[user.id],
			);
			expect(quiet.rows[0].n).toBe(0);
			await client.query(migration);
			const stamped = await client.query(
				`SELECT "op" FROM sync_change WHERE entity = 'budget_book' AND "entityId" = 'book-after-rollback'`,
			);
			expect(stamped.rows).toEqual([{ op: "U" }]);
		});
	});
});
