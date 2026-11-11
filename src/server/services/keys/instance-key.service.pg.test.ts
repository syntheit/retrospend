/**
 * The instance key for shared text, in the keystore schema. Hand-derived
 * expectations:
 *
 *   no actor, or an actor the database does not know -> refused (28000)
 *   a signed-in user, or a live guest session        -> the key, made on first use
 *   a guest idle for 91 days                         -> refused; 89 days -> works
 *   eight concurrent first calls                     -> one row, one key
 *   key wiped while "instanceKeySince" is set        -> keystore_lost, nothing made
 *   operator clears the marker                       -> a new key (opens nothing old)
 *   master key with the same id, other bytes         -> auth_failed
 *   wrapped key copied to another key id             -> auth_failed (AAD names the id)
 *   canary: first start writes it, same key verifies, wrong key stops
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import {
	evictInstanceKeyring,
	getOrCreateInstanceKeyring,
	InstanceKeyError,
	type InstanceKeyActor,
} from "./instance-key.service";
import {
	assertMasterKeyCanary,
	MasterCanaryError,
} from "./master-canary.service";

const MIGRATION = "20261111100000_instance_text_key";
const master = (id = 1) => new Keyring([{ id, key: randomBytes(32) }]);
const cell: FieldAad = { table: "shared_transaction", column: "notes", rowId: "s1" };
const DAY = 24 * 60 * 60 * 1000;

type Row = { keyId: number; wrappedKey: string; masterKeyId: bigint };

const rows = () =>
	adminDb.$queryRaw<Row[]>`
		SELECT "keyId", "wrappedKey", "masterKeyId"
		FROM keystore."instance_text_key" ORDER BY "keyId"`;

const markers = async () =>
	(
		await adminDb.$queryRaw<
			{ since: Date | null; canary: string | null }[]
		>`SELECT "instanceKeySince" AS "since", "masterKeyCanary" AS "canary"
		  FROM "app_settings" WHERE "id" = 'app_settings_singleton'`
	)[0];

/** Back to a database that never made an instance key or a canary. */
async function reset() {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`
		UPDATE "app_settings" SET "instanceKeySince" = NULL, "masterKeyCanary" = NULL`;
}

beforeEach(reset);
afterAll(reset);

async function failure(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(e: unknown) => e,
	);
}

async function expectInstanceError(promise: Promise<unknown>, code: string) {
	const error = await failure(promise);
	expect(error).toBeInstanceOf(InstanceKeyError);
	expect((error as InstanceKeyError).code).toBe(code);
	return error as InstanceKeyError;
}

async function expectFieldError(promise: Promise<unknown>, code: string) {
	const error = await failure(promise);
	expect(error).toBeInstanceOf(FieldCryptoError);
	expect((error as FieldCryptoError).code).toBe(code);
}

async function guest(lastActiveAt = new Date()): Promise<InstanceKeyActor> {
	const row = await adminDb.guestSession.create({
		data: {
			name: "Guest",
			email: `${randomUUID()}@pg-test.invalid`,
			magicLinkId: randomUUID(),
			projectId: randomUUID(),
			sessionToken: randomUUID(),
			lastActiveAt,
		},
		select: { id: true },
	});
	return { kind: "guest", guestSessionId: row.id };
}

const asUser = async (): Promise<InstanceKeyActor> => ({
	kind: "user",
	userId: (await createTestUser()).user.id,
});

/** Evicts first, so every call is a fresh load. */
const load = (actor: InstanceKeyActor, mk: Keyring | undefined) => {
	evictInstanceKeyring();
	return getOrCreateInstanceKeyring(actor, mk);
};

describe("getOrCreateInstanceKeyring", () => {
	it("makes one key on first use for a signed-in user and returns it after", async () => {
		const actor = await asUser();
		const mk = master();
		const first = await load(actor, mk);
		const second = await load(actor, mk);

		expect(openField(second, sealField(first, "Dinner", cell), cell)).toBe(
			"Dinner",
		);
		const stored = await rows();
		expect(stored).toHaveLength(1);
		expect(stored[0]?.keyId).toBe(1);
		expect(stored[0]?.masterKeyId).toBe(1n);
	});

	it("serves a live guest session the same key as a user", async () => {
		const mk = master();
		const viaUser = await load(await asUser(), mk);
		const viaGuest = await load(await guest(), mk);

		expect(
			openField(viaGuest, sealField(viaUser, "Shared", cell), cell),
		).toBe("Shared");
		expect(await rows()).toHaveLength(1);
	});

	it("lets a guest make the first key", async () => {
		const mk = master();
		const viaGuest = await load(await guest(), mk);
		const viaUser = await load(await asUser(), mk);
		expect(openField(viaUser, sealField(viaGuest, "Hi", cell), cell)).toBe(
			"Hi",
		);
		expect(await rows()).toHaveLength(1);
	});

	it("refuses a guest id that is no guest session, and an empty actor", async () => {
		const mk = master();
		const fake = await expectInstanceError(
			load({ kind: "guest", guestSessionId: randomUUID() }, mk),
			"no_actor",
		);
		expect(fake.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
		await expectInstanceError(
			load({ kind: "guest", guestSessionId: "" }, mk),
			"no_actor",
		);
		await expectInstanceError(load({ kind: "user", userId: "" }, mk), "no_actor");
		await expectInstanceError(
			load({ kind: "user", userId: randomUUID() }, mk),
			"no_actor",
		);
		// Refused means nothing was made.
		expect(await rows()).toHaveLength(0);
		expect((await markers())?.since ?? null).toBeNull();
	});

	it("refuses a guest idle for more than 90 days", async () => {
		const mk = master();
		await expectInstanceError(
			load(await guest(new Date(Date.now() - 91 * DAY)), mk),
			"no_actor",
		);
		expect(
			await load(await guest(new Date(Date.now() - 89 * DAY)), mk),
		).toBeInstanceOf(Keyring);
	});

	it("needs a master key", async () => {
		await expectInstanceError(load(await asUser(), undefined), "master_key_missing");
		expect(await rows()).toHaveLength(0);
	});

	it("is idempotent when callers race on the first use", async () => {
		const mk = master();
		const actors = await Promise.all(
			Array.from({ length: 8 }, async (_, i) =>
				i % 2 === 0 ? asUser() : guest(),
			),
		);
		const rings = await Promise.all(actors.map((a) => load(a, mk)));

		expect(await rows()).toHaveLength(1);
		const sealed = sealField(rings[0] as Keyring, "Race", cell);
		for (const ring of rings) expect(openField(ring, sealed, cell)).toBe("Race");
	});

	it("sets the marker once, with the key", async () => {
		const actor = await asUser();
		const mk = master();
		const before = Date.now();
		await load(actor, mk);
		const first = (await markers())?.since;
		expect(first).toBeInstanceOf(Date);
		expect(Math.abs((first?.getTime() ?? 0) - before)).toBeLessThan(10_000);
		await load(actor, mk);
		expect((await markers())?.since).toEqual(first);
	});

	it("refuses to make a new key when the marker is set and the key is gone", async () => {
		const actor = await asUser();
		const mk = master();
		const sealed = sealField(await load(actor, mk), "Kept", cell);
		const marker = (await markers())?.since;
		// A main dump restored without the keystore: the marker stays, the key goes.
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;

		await expectInstanceError(load(actor, mk), "keystore_lost");
		expect(await rows()).toHaveLength(0);
		await expectInstanceError(load(actor, mk), "keystore_lost");
		expect((await markers())?.since).toEqual(marker);

		// An operator who accepts the loss clears the marker; a new key does not
		// open what the first one sealed.
		await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
		const reborn = await load(actor, mk);
		expect(await rows()).toHaveLength(1);
		await expectFieldError(
			Promise.resolve().then(() => openField(reborn, sealed, cell)),
			"auth_failed",
		);
	});

	it("does not open a key wrapped by another master key with the same id", async () => {
		const actor = await asUser();
		await load(actor, master(1));
		await expectFieldError(load(actor, master(1)), "auth_failed");
	});

	it("does not open a wrapped key copied to another key id", async () => {
		const actor = await asUser();
		const mk = master();
		await load(actor, mk);
		const [one] = await rows();
		await adminDb.$executeRaw`
			INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
			VALUES (2, ${one?.wrappedKey ?? ""}, 1)`;
		await expectFieldError(load(actor, mk), "auth_failed");
	});

	it("keeps older key ids in the ring after a rotation adds one", async () => {
		const actor = await asUser();
		const mk = master();
		const old = await load(actor, mk);
		const sealedOld = sealField(old, "Old", cell);
		// What D12 does: a key 2, wrapped under the master key with its own AAD.
		const wrapped = sealField(mk, randomBytes(32).toString("base64"), {
			table: "keystore.instance_text_key",
			column: "wrappedKey",
			rowId: "2",
		});
		await adminDb.$executeRaw`
			INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
			VALUES (2, ${wrapped}, 1)`;
		const ring = await load(actor, mk);
		expect(ring.currentId).toBe(2);
		expect(ring.ids).toEqual([1, 2]);
		expect(openField(ring, sealedOld, cell)).toBe("Old");
	});

	it("caches the keyring for a short time and then asks the database again", async () => {
		const actor = await asUser();
		const mk = master();
		evictInstanceKeyring();
		const t0 = 1_000_000;
		const first = await getOrCreateInstanceKeyring(actor, mk, t0);
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		// Within the TTL the process keeps its key; the database is not asked.
		expect(await getOrCreateInstanceKeyring(actor, mk, t0 + 60_000)).toBe(first);
		await expectInstanceError(
			getOrCreateInstanceKeyring(actor, mk, t0 + 6 * 60_000),
			"keystore_lost",
		);
		// A failure is not cached.
		await expectInstanceError(
			getOrCreateInstanceKeyring(actor, mk, t0 + 6 * 60_000 + 1),
			"keystore_lost",
		);
	});
});

/** Runs `sql` as the app role with the given settings; returns the SQLSTATE or "ok". */
async function asApp(
	client: Client,
	settings: Record<string, string>,
	statement: string,
): Promise<string> {
	await client.query("SAVEPOINT door");
	try {
		for (const [name, value] of Object.entries(settings))
			await client.query("SELECT set_config($1, $2, true)", [name, value]);
		await client.query("SELECT set_config('role', 'retrospend_app', true)");
		await client.query(statement);
		return "ok";
	} catch (error) {
		return (error as { code?: string }).code ?? "error";
	} finally {
		await client.query("ROLLBACK TO SAVEPOINT door");
	}
}

describe("the keystore functions, called as the app role", () => {
	const read = "SELECT * FROM keystore.instance_text_keys()";
	const mint = "SELECT * FROM keystore.create_first_instance_key('x', 1::bigint)";

	it("refuse both doors with no actor, an unknown user and an unknown guest", async () => {
		await inRolledBackTransaction(async (client) => {
			for (const sql of [read, mint]) {
				expect(await asApp(client, {}, sql)).toBe("28000");
				expect(
					await asApp(client, { "app.current_user_id": "" }, sql),
				).toBe("28000");
				expect(
					await asApp(client, { "app.current_user_id": randomUUID() }, sql),
				).toBe("28000");
				expect(
					await asApp(client, { "app.guest_session_id": randomUUID() }, sql),
				).toBe("28000");
			}
			expect(
				await asApp(client, {}, 'SELECT * FROM keystore."instance_text_key"'),
			).toBe("42501");
			// The helper is the owner's: the app role cannot call it directly.
			expect(
				await asApp(client, {}, "SELECT keystore.require_instance_actor()"),
			).toBe("42501");
		});
	});

	it("accept a live guest and a real user, and make the app_settings row when it is missing", async () => {
		const who = await createTestUser();
		const guestActor = await guest();
		await inRolledBackTransaction(async (client) => {
			await client.query("DELETE FROM keystore.instance_text_key");
			await client.query('DELETE FROM "app_settings"');
			expect(
				await asApp(client, { "app.current_user_id": who.user.id }, mint),
			).toBe("ok");
			expect(
				await asApp(
					client,
					{
						"app.guest_session_id":
							guestActor.kind === "guest" ? guestActor.guestSessionId : "",
					},
					read,
				),
			).toBe("ok");
			// The mint above was rolled back with its savepoint: run one for real.
			await client.query("SELECT set_config('app.current_user_id', $1, true)", [
				who.user.id,
			]);
			await client.query("SELECT set_config('role', 'retrospend_app', true)");
			await client.query(mint);
			await client.query("RESET role");
			const { rows: settings } = await client.query<{ since: Date | null }>(
				`SELECT "instanceKeySince" AS since FROM "app_settings"
				 WHERE "id" = 'app_settings_singleton'`,
			);
			expect(settings[0]?.since).toBeInstanceOf(Date);
		});
	});
});

describe("catalog", () => {
	it("makes the doors definer functions with a fixed search_path, for the app role only", async () => {
		const result = await adminDb.$queryRaw<
			{
				name: string;
				secdef: boolean;
				config: string[];
				app: boolean;
				pub: boolean;
			}[]
		>`
			SELECT p.proname AS name, p.prosecdef AS secdef, p.proconfig AS config,
			       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS app,
			       has_function_privilege('public', p.oid, 'EXECUTE') AS pub
			FROM pg_proc p
			WHERE p.pronamespace = 'keystore'::regnamespace
			  AND p.proname IN ('instance_text_keys', 'create_first_instance_key', 'require_instance_actor')
			ORDER BY 1`;
		const config = ["search_path=pg_catalog, pg_temp"];
		expect(result).toEqual([
			{ name: "create_first_instance_key", secdef: true, config, app: true, pub: false },
			{ name: "instance_text_keys", secdef: true, config, app: true, pub: false },
			{ name: "require_instance_actor", secdef: true, config, app: false, pub: false },
		]);
	});

	it("gives the app role no way to read the table or the two markers", async () => {
		const [priv] = await adminDb.$queryRaw<
			{ table: boolean; since: boolean; canary: boolean; rls: boolean }[]
		>`
			SELECT has_table_privilege('retrospend_app', 'keystore.instance_text_key', 'SELECT, INSERT, UPDATE, DELETE') AS "table",
			       has_column_privilege('retrospend_app', 'app_settings', 'instanceKeySince', 'SELECT, UPDATE') AS since,
			       has_column_privilege('retrospend_app', 'app_settings', 'masterKeyCanary', 'SELECT, UPDATE') AS canary,
			       (SELECT relrowsecurity FROM pg_class WHERE oid = 'keystore.instance_text_key'::regclass) AS rls`;
		expect(priv).toEqual({ table: false, since: false, canary: false, rls: true });
	});

	it("the migration runs again safely", async () => {
		const migrationSql = readFileSync(
			join(REPO_ROOT, "prisma/migrations", MIGRATION, "migration.sql"),
			"utf8",
		);
		const actor = await asUser();
		await load(actor, master());
		const before = await rows();
		await inRolledBackTransaction(async (client) => {
			await client.query(migrationSql);
			await client.query(migrationSql);
			const { rows: after } = await client.query(
				'SELECT "keyId", "wrappedKey" FROM keystore."instance_text_key"',
			);
			expect(after).toHaveLength(before.length);
			expect(
				await asApp(
					client,
					{ "app.current_user_id": actor.kind === "user" ? actor.userId : "" },
					"SELECT * FROM keystore.instance_text_keys()",
				),
			).toBe("ok");
		});
	});

	it("the rollback snippet takes the doors, the table and the columns away, twice", async () => {
		const snippet = readFileSync(
			join(REPO_ROOT, "prisma/rollback", `${MIGRATION}.sql`),
			"utf8",
		);
		const migration = readFileSync(
			join(REPO_ROOT, "prisma/migrations", MIGRATION, "migration.sql"),
			"utf8",
		);
		const left = async (client: Client) =>
			(
				await client.query<{ what: string }>(`
					SELECT 'function ' || proname AS what FROM pg_proc
					 WHERE pronamespace = 'keystore'::regnamespace
					   AND proname IN ('instance_text_keys', 'create_first_instance_key', 'require_instance_actor')
					UNION ALL
					SELECT 'table ' || relname FROM pg_class
					 WHERE relnamespace = 'keystore'::regnamespace AND relname = 'instance_text_key'
					UNION ALL
					SELECT 'column ' || attname FROM pg_attribute
					 WHERE attrelid = 'app_settings'::regclass AND NOT attisdropped
					   AND attname IN ('instanceKeySince', 'masterKeyCanary')
					ORDER BY 1`)
			).rows.map((r) => r.what);
		await inRolledBackTransaction(async (client) => {
			expect(await left(client)).toHaveLength(6);
			await client.query(snippet);
			expect(await left(client)).toEqual([]);
			await client.query(snippet);
			expect(await left(client)).toEqual([]);
			// The user key doors are untouched.
			const { rows: user } = await client.query(
				`SELECT 1 FROM pg_proc WHERE pronamespace = 'keystore'::regnamespace
				 AND proname = 'create_first_data_key'`,
			);
			expect(user).toHaveLength(1);
			// And the migration brings it all back.
			await client.query(migration);
			expect(await left(client)).toHaveLength(6);
		});
	});
});

describe("assertMasterKeyCanary", () => {
	it("writes the canary on the first start and verifies it after", async () => {
		const mk = master();
		expect(await assertMasterKeyCanary(mk)).toBe("written");
		const stored = (await markers())?.canary;
		expect(stored?.startsWith("\u0001k1:")).toBe(true);
		expect(await assertMasterKeyCanary(mk)).toBe("verified");
		expect((await markers())?.canary).toBe(stored);
	});

	it("stops on a wrong key with the same id", async () => {
		await assertMasterKeyCanary(master(1));
		const error = await failure(assertMasterKeyCanary(master(1)));
		expect(error).toBeInstanceOf(MasterCanaryError);
		expect((error as MasterCanaryError).message).toContain("DATA_MASTER_KEY");
	});

	it("stops on a key set that lacks the id the canary was sealed with", async () => {
		await assertMasterKeyCanary(master(1));
		expect(await failure(assertMasterKeyCanary(master(2)))).toBeInstanceOf(
			MasterCanaryError,
		);
	});

	it("passes after a rotation that keeps the old key, and stops when it is dropped", async () => {
		const old = randomBytes(32);
		await assertMasterKeyCanary(new Keyring([{ id: 1, key: old }]));
		const rotated = new Keyring([
			{ id: 2, key: randomBytes(32) },
			{ id: 1, key: old },
		]);
		expect(await assertMasterKeyCanary(rotated)).toBe("verified");
		expect(
			await failure(
				assertMasterKeyCanary(new Keyring([{ id: 2, key: randomBytes(32) }])),
			),
		).toBeInstanceOf(MasterCanaryError);
	});

	it("rejects a stored value that is not the canary", async () => {
		const mk = master();
		await assertMasterKeyCanary(mk);
		// Sealed with the right key but for another cell, so the AAD fails.
		const wrongCell = sealField(mk, "retrospend master key canary v1", {
			table: "app_settings",
			column: "other",
			rowId: "app_settings_singleton",
		});
		await adminDb.$executeRaw`UPDATE "app_settings" SET "masterKeyCanary" = ${wrongCell}`;
		expect(await failure(assertMasterKeyCanary(mk))).toBeInstanceOf(
			MasterCanaryError,
		);
		// Right cell, wrong text.
		const wrongText = sealField(mk, "something else", {
			table: "app_settings",
			column: "masterKeyCanary",
			rowId: "app_settings_singleton",
		});
		await adminDb.$executeRaw`UPDATE "app_settings" SET "masterKeyCanary" = ${wrongText}`;
		expect(await failure(assertMasterKeyCanary(mk))).toBeInstanceOf(
			MasterCanaryError,
		);
		// Not a ciphertext at all.
		await adminDb.$executeRaw`UPDATE "app_settings" SET "masterKeyCanary" = 'plain'`;
		expect(await failure(assertMasterKeyCanary(mk))).toBeInstanceOf(
			MasterCanaryError,
		);
	});

	it("does nothing without a master key", async () => {
		expect(await assertMasterKeyCanary(undefined)).toBe("skipped");
		expect((await markers())?.canary ?? null).toBeNull();
	});

	it("lets one of two servers that start together with different keys win and stops the other", async () => {
		const results = await Promise.allSettled([
			assertMasterKeyCanary(master(1)),
			assertMasterKeyCanary(master(1)),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected");
		expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
			MasterCanaryError,
		);
	});

	it("makes the app_settings row when none exists yet", async () => {
		const rollback = new Error("rollback");
		await adminDb
			.$transaction(async (tx) => {
				await tx.$executeRaw`DELETE FROM "app_settings"`;
				expect(await assertMasterKeyCanary(master(), tx)).toBe("written");
				const [row] = await tx.$queryRaw<{ canary: string | null }[]>`
					SELECT "masterKeyCanary" AS canary FROM "app_settings"
					WHERE "id" = 'app_settings_singleton'`;
				expect(row?.canary).not.toBeNull();
				throw rollback;
			})
			.catch((e: unknown) => {
				if (e !== rollback) throw e;
			});
	});
});
