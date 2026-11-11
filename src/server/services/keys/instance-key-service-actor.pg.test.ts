/**
 * The service actor for the instance key (E2EE D11 PR 3.1, migration
 * 20261111200000_instance_key_service_actor). Hand-derived expectations:
 *
 *   current_setting('role') inside a definer function -> the session's setting, not the definer
 *   owner connection, app.instance_service = 'on'     -> the keys
 *   owner connection, no flag or 'off'                -> 28000
 *   the flag as retrospend_app (scoped batch shape)   -> 28000, read as "refused" (no_actor)
 *   the flag inside userTransaction                   -> 28000, read as "refused" (no_actor)
 *   the flag after SET ROLE to the owner itself       -> 28000: any role set is refused
 *   findInstanceKeyring with no key                   -> undefined, nothing made
 *   findInstanceKeyring after a user minted           -> the same key
 *   migration twice, rollback twice, migration again  -> on, off, on; grants unchanged
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { keystoreDb } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
	getOrCreateInstanceKeyring,
} from "./instance-key.service";
import { keystoreFailure } from "./keystore-errors";

const MIGRATION = "20261111200000_instance_key_service_actor";
const master = () => new Keyring([{ id: 1, key: randomBytes(32) }]);
const cell: FieldAad = { table: "project", column: "name", rowId: "p1" };
const READ = "SELECT * FROM keystore.instance_text_keys()";

async function reset() {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
}

beforeEach(reset);
afterAll(reset);

/** Runs the statements in a savepoint on the owner connection; the SQLSTATE or "ok". */
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

const FLAG_ON = "SELECT set_config('app.instance_service', 'on', true)";
const AS_APP = "SELECT set_config('role', 'retrospend_app', true)";

async function failure(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(e: unknown) => e,
	);
}

describe("current_setting('role') inside a SECURITY DEFINER function", () => {
	// The service branch relies on this; it must hold before anything else.
	it("shows the session's role setting, not the definer", async () => {
		await inRolledBackTransaction(async (client) => {
			await client.query(`
				CREATE FUNCTION keystore.d11_role_probe()
				RETURNS TABLE (setting text, who text)
				LANGUAGE plpgsql SECURITY DEFINER
				SET search_path = pg_catalog, pg_temp
				AS $$ BEGIN
				  RETURN QUERY SELECT pg_catalog.current_setting('role', true), current_user::text;
				END $$`);
			await client.query(
				"GRANT EXECUTE ON FUNCTION keystore.d11_role_probe() TO retrospend_app",
			);
			const probe = async () =>
				(await client.query("SELECT * FROM keystore.d11_role_probe()")).rows[0];
			expect(await probe()).toEqual({
				setting: "none",
				who: "retrospend_owner",
			});
			await client.query(AS_APP);
			expect(await probe()).toEqual({
				setting: "retrospend_app",
				who: "retrospend_owner",
			});
		});
	});
});

describe("the service branch of require_instance_actor", () => {
	it("admits the owner connection with the flag on, and nothing else", async () => {
		await inRolledBackTransaction(async (client) => {
			expect(await attempt(client, [FLAG_ON, READ])).toBe("ok");
			expect(await attempt(client, [READ])).toBe("28000");
			expect(
				await attempt(client, [
					"SELECT set_config('app.instance_service', 'off', true)",
					READ,
				]),
			).toBe("28000");
			// The scoped batch's shape: an id that is no user, the app role, the flag.
			expect(
				await attempt(client, [
					`SELECT set_config('app.current_user_id', '${randomUUID()}', true)`,
					AS_APP,
					FLAG_ON,
					READ,
				]),
			).toBe("28000");
			// The check is positive: any role set at all is refused.
			expect(
				await attempt(client, [
					"SET LOCAL ROLE retrospend_owner",
					FLAG_ON,
					READ,
				]),
			).toBe("28000");
		});
	});

	it("refuses the flag on the scoped batch and inside userTransaction, as no_actor", async () => {
		const batch = failure(
			keystoreDb.$transaction([
				keystoreDb.$executeRaw`SELECT set_config('app.current_user_id', ${randomUUID()}, true),
				                              set_config('role', 'retrospend_app', true),
				                              set_config('app.instance_service', 'on', true)`,
				keystoreDb.$queryRaw`SELECT * FROM keystore.instance_text_keys()`,
			]),
		);
		const inTransaction = failure(
			userTransaction(keystoreDb, randomUUID(), async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.instance_service', 'on', true)`;
				return tx.$queryRaw`SELECT * FROM keystore.instance_text_keys()`;
			}),
		);
		// "refused" is the kind InstanceKeyError reports as no_actor.
		expect(keystoreFailure(await batch)).toBe("refused");
		expect(keystoreFailure(await inTransaction)).toBe("refused");
	});
});

describe("findInstanceKeyring", () => {
	it("finds no key and makes none", async () => {
		expect(await findInstanceKeyring(master())).toBeUndefined();
		const [row] = await adminDb.$queryRaw<
			{ keys: bigint; since: Date | null }[]
		>`
			SELECT (SELECT count(*) FROM keystore."instance_text_key") AS "keys",
			       (SELECT "instanceKeySince" FROM "app_settings"
			         WHERE "id" = 'app_settings_singleton') AS "since"`;
		expect(row?.keys).toBe(0n);
		expect(row?.since ?? null).toBeNull();
	});

	it("reads the key a user made, as the service", async () => {
		const mk = master();
		const who = await createTestUser();
		const minted = await getOrCreateInstanceKeyring(
			{ kind: "user", userId: who.user.id },
			mk,
		);
		evictInstanceKeyring();
		const found = await findInstanceKeyring(mk);
		expect(found).toBeInstanceOf(Keyring);
		expect(
			openField(found as Keyring, sealField(minted, "Trip", cell), cell),
		).toBe("Trip");
	});
});

describe("the migration and its rollback", () => {
	const read = (folder: string) =>
		readFileSync(join(REPO_ROOT, folder), "utf8");
	const migration = read(`prisma/migrations/${MIGRATION}/migration.sql`);
	const snippet = read(`prisma/rollback/${MIGRATION}.sql`);

	it("runs twice, rolls back twice, and comes back, with the grants unchanged", async () => {
		const who = await createTestUser();
		const asUser = [
			`SELECT set_config('app.current_user_id', '${who.user.id}', true)`,
			AS_APP,
			READ,
		];
		const catalog = async (client: Client) =>
			(
				await client.query(`
					SELECT p.prosecdef AS definer, p.proconfig AS config, p.proacl::text AS acl,
					       pg_get_userbyid(p.proowner) AS owner
					FROM pg_proc p
					WHERE p.oid = 'keystore.require_instance_actor()'::regprocedure`)
			).rows[0];
		await inRolledBackTransaction(async (client) => {
			const before = await catalog(client);
			expect(before).toMatchObject({
				definer: true,
				config: ["search_path=pg_catalog, pg_temp"],
				owner: "retrospend_owner",
			});
			await client.query(migration);
			await client.query(migration);
			expect(await catalog(client)).toEqual(before);
			expect(await attempt(client, [FLAG_ON, READ])).toBe("ok");

			await client.query(snippet);
			await client.query(snippet);
			expect(await catalog(client)).toEqual(before);
			expect(await attempt(client, [FLAG_ON, READ])).toBe("28000");
			expect(await attempt(client, asUser)).toBe("ok");

			await client.query(migration);
			expect(await attempt(client, [FLAG_ON, READ])).toBe("ok");
			expect(await attempt(client, asUser)).toBe("ok");
		});
	});
});
