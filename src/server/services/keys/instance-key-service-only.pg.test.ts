/**
 * The service-only instance key (migration 20261117100000_instance_key_service_only)
 * and its rollback snippet. Hand-derived expectations:
 *
 *   migrated:    retrospend_app has no EXECUTE on the two doors (42501), even with a real user id
 *   migrated:    a user id on the owner connection, no service flag  -> 28000
 *   migrated:    epoch set, no key row, marker null, service mints   -> KS001, nothing made
 *   rolled back: retrospend_app may call both doors with a real user id (the old grants)
 *   rolled back: the same mint after the epoch is not refused (the old body)
 *   rolled back twice, then migrated again                           -> the migrated functions and ACLs, byte for byte
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";

const MIGRATION = "20261117100000_instance_key_service_only";
const read = (folder: string) => readFileSync(join(REPO_ROOT, folder), "utf8");
const migration = read(`prisma/migrations/${MIGRATION}/migration.sql`);
const snippet = read(`prisma/rollback/${MIGRATION}.sql`);

const READ = "SELECT * FROM keystore.instance_text_keys()";
const MINT = "SELECT * FROM keystore.create_first_instance_key('x', 1::bigint)";
const FLAG_ON = "SELECT set_config('app.instance_service', 'on', true)";
const AS_APP = "SELECT set_config('role', 'retrospend_app', true)";
const NO_EPOCH_ROW = `
	DELETE FROM keystore.instance_text_key;
	INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
	VALUES ('app_settings_singleton', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
	ON CONFLICT ("id") DO UPDATE SET "instanceKeySince" = NULL,
	       "fieldEncryptionSince" = now() AT TIME ZONE 'UTC'`;

/** Runs the statements in a savepoint; the SQLSTATE or "ok". */
async function attempt(client: Client, statements: string[]): Promise<string> {
	await client.query("SAVEPOINT attempt");
	try {
		for (const sql of statements) await client.query(sql);
		return "ok";
	} catch (error) {
		return (error as { code?: string }).code ?? "error";
	} finally {
		await client.query("ROLLBACK TO SAVEPOINT attempt");
	}
}

/** The three functions, whole: definition text and ACL. */
async function shape(client: Client): Promise<string[]> {
	const { rows } = await client.query<{ line: string }>(`
		SELECT p.proname || ' ' || pg_get_functiondef(p.oid) || ' ' || coalesce(p.proacl::text, 'default') AS line
		FROM pg_proc p
		WHERE p.pronamespace = 'keystore'::regnamespace
		  AND p.proname IN ('instance_text_keys', 'create_first_instance_key', 'require_instance_actor')
		ORDER BY p.proname`);
	return rows.map((r) => r.line);
}

describe("the migrated doors", () => {
	it("refuse the app role with a real user, before and after the epoch", async () => {
		const who = await createTestUser();
		const asUser = `SELECT set_config('app.current_user_id', '${who.user.id}', true)`;
		await inRolledBackTransaction(async (client) => {
			for (const sql of [READ, MINT]) {
				expect(await attempt(client, [asUser, AS_APP, sql])).toBe("42501");
				expect(await attempt(client, [asUser, AS_APP, FLAG_ON, sql])).toBe(
					"42501",
				);
			}
			await client.query(NO_EPOCH_ROW);
			expect(await attempt(client, [asUser, AS_APP, MINT])).toBe("42501");
		});
	});

	it("refuse a user id on the owner connection without the service flag", async () => {
		const who = await createTestUser();
		await inRolledBackTransaction(async (client) => {
			const asUser = `SELECT set_config('app.current_user_id', '${who.user.id}', true)`;
			for (const sql of [READ, MINT])
				expect(await attempt(client, [asUser, sql])).toBe("28000");
		});
	});
});

describe("create_first_instance_key after the epoch", () => {
	it("refuses to make a key when the epoch is set, no key exists and the marker is null", async () => {
		await inRolledBackTransaction(async (client) => {
			await client.query(NO_EPOCH_ROW);
			await client.query(FLAG_ON);
			await client.query("SAVEPOINT mint");
			await expect(client.query(MINT)).rejects.toMatchObject({ code: "KS001" });
			await client.query("ROLLBACK TO SAVEPOINT mint");
			const { rows } = await client.query<{ n: number; since: Date | null }>(`
				SELECT (SELECT count(*)::int FROM keystore.instance_text_key) AS n,
				       (SELECT "instanceKeySince" FROM "app_settings") AS since`);
			expect(rows[0]).toEqual({ n: 0, since: null });
		});
	});

	it("still reads the key that is there", async () => {
		await inRolledBackTransaction(async (client) => {
			await client.query(FLAG_ON);
			await client.query(
				`DELETE FROM keystore.instance_text_key;
				 DELETE FROM "app_settings"`,
			);
			await client.query(MINT);
			await client.query(
				`UPDATE "app_settings" SET "fieldEncryptionSince" = now() AT TIME ZONE 'UTC'`,
			);
			const { rows } = await client.query(MINT);
			expect(rows).toHaveLength(1);
		});
	});
});

describe("the rollback snippet", () => {
	it("gives the app role its doors and the user actor back, twice, and the migration closes them again", async () => {
		const who = await createTestUser();
		const asUser = `SELECT set_config('app.current_user_id', '${who.user.id}', true)`;
		await inRolledBackTransaction(async (client) => {
			const migrated = await shape(client);
			expect(migrated).toHaveLength(3);

			await client.query(snippet);
			await client.query(snippet);
			const rolledBack = await shape(client);
			expect(rolledBack).not.toEqual(migrated);
			// Old grants: the app role calls both doors as a real user.
			for (const sql of [READ, MINT])
				expect(await attempt(client, [asUser, AS_APP, sql])).toBe("ok");
			// The service still works, and the old mint is not refused after the epoch.
			expect(await attempt(client, [FLAG_ON, READ])).toBe("ok");
			expect(await attempt(client, [NO_EPOCH_ROW, FLAG_ON, MINT])).toBe("ok");
			// The helper stays the owner's.
			expect(
				await attempt(client, [
					AS_APP,
					"SELECT keystore.require_instance_actor()",
				]),
			).toBe("42501");

			await client.query(migration);
			await client.query(migration);
			expect(await shape(client)).toEqual(migrated);
			for (const sql of [READ, MINT])
				expect(await attempt(client, [asUser, AS_APP, sql])).toBe("42501");
		});
	});
});
