/**
 * Per-user data keys in the keystore schema. Hand-derived expectations:
 *
 *   one user, two calls            -> one row, the same key both times
 *   eight concurrent first calls   -> one row, one key
 *   user A's key opens B's text    -> never (auth_failed)
 *   A's wrapped key copied to B    -> does not open (AAD names the user)
 *   A's scoped transaction         -> sees only A's row, by any route
 *   empty or unknown user setting  -> the functions refuse
 *   destroy                        -> row count 1, then 0; old text unreadable
 *   master key with the same id but other bytes -> the wrapped key fails
 *   first key made                -> user."dataKeySince" is set, once
 *   marker set and no key row     -> keystore_lost, no new key, marker kept
 *   operator clears the marker    -> the next call makes a key again
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, withSuperuser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import {
	DataKeyError,
	destroyDataKeys,
	getOrCreateDataKeyring,
} from "./data-key.service";

const master = (id = 1) => new Keyring([{ id, key: randomBytes(32) }]);
const cell: FieldAad = { table: "expense", column: "title", rowId: "e1" };

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

/**
 * Renaming a schema needs CREATE on the database, which the app's role
 * (retrospend_owner) does not have, so the keystore is hidden and put back
 * on a superuser connection.
 */
const renameKeystore = (from: string, to: string) =>
	withSuperuser((client) =>
		client.query(`ALTER SCHEMA ${from} RENAME TO ${to}`),
	);

/** What a signed-in request does: the scoped client's transaction. */
const keyringOf = (who: TestUser, mk: Keyring | undefined) =>
	who.db.$transaction((tx) => getOrCreateDataKeyring(tx, mk));

type Row = {
	userId: string;
	keyId: number;
	wrappedKey: string;
	masterKeyId: bigint;
};

const rowsOf = (userId: string) =>
	adminDb.$queryRaw<Row[]>`
		SELECT "userId", "keyId", "wrappedKey", "masterKeyId"
		FROM keystore."user_data_key" WHERE "userId" = ${userId}`;

/** What an operator does to allow a new key after a loss (docs/self-hosting.md). */
const clearMarker = (userId: string) =>
	adminDb.$executeRaw`UPDATE "user" SET "dataKeySince" = NULL WHERE "id" = ${userId}`;

const markerOf = async (userId: string) =>
	(
		await adminDb.$queryRaw<{ since: Date | null }[]>`
			SELECT "dataKeySince" AS "since" FROM "user" WHERE "id" = ${userId}`
	)[0]?.since;

async function failure(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(e: unknown) => e,
	);
}

async function expectCode(promise: Promise<unknown>, code: string) {
	const error = await failure(promise);
	expect(error).toBeInstanceOf(FieldCryptoError);
	expect((error as FieldCryptoError).code).toBe(code);
}

async function expectDataKeyError(promise: Promise<unknown>, code: string) {
	const error = await failure(promise);
	expect(error).toBeInstanceOf(DataKeyError);
	expect((error as DataKeyError).code).toBe(code);
}

describe("getOrCreateDataKeyring", () => {
	it("makes one key on first use and returns the same key after", async () => {
		const me = await createTestUser();
		const mk = master();
		const first = await keyringOf(me, mk);
		const second = await keyringOf(me, mk);

		const sealed = sealField(first, "Coffee", cell);
		expect(openField(second, sealed, cell)).toBe("Coffee");
		const rows = await rowsOf(me.user.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.keyId).toBe(1);
	});

	it("is idempotent when callers race on the first use", async () => {
		const me = await createTestUser();
		const mk = master();
		const keyrings = await Promise.all(
			Array.from({ length: 8 }, () => keyringOf(me, mk)),
		);

		expect(await rowsOf(me.user.id)).toHaveLength(1);
		const sealed = sealField(keyrings[0] as Keyring, "Rent", cell);
		for (const keyring of keyrings)
			expect(openField(keyring, sealed, cell)).toBe("Rent");
	});

	it("gives each user their own key", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		const keyA = await keyringOf(a, mk);
		const keyB = await keyringOf(b, mk);

		const sealed = sealField(keyA, "Only A", cell);
		await expectCode(
			Promise.resolve().then(() => openField(keyB, sealed, cell)),
			"auth_failed",
		);
	});

	it("does not open a wrapped key copied to another user", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		await keyringOf(a, mk);
		const [row] = await rowsOf(a.user.id);
		await adminDb.$executeRaw`
			INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
			VALUES (${b.user.id}, 1, ${row?.wrappedKey}, 1)`;

		await expectCode(keyringOf(b, mk), "auth_failed");
	});

	it("stores a key that opens with the master key and with no other", async () => {
		const me = await createTestUser();
		const mk = master(7);
		const keyring = await keyringOf(me, mk);
		const [row] = await rowsOf(me.user.id);
		if (!row) throw new Error("no row");

		expect(Number(row.masterKeyId)).toBe(7);
		const aad = {
			table: "keystore.user_data_key",
			column: "wrappedKey",
			rowId: `${me.user.id}:1`,
		};
		const unwrapped = openField(mk, row.wrappedKey, aad);
		expect(Buffer.from(unwrapped, "base64")).toHaveLength(32);
		// The unwrapped bytes are the key the keyring seals with.
		const sealed = sealField(keyring, "Check", cell);
		const rebuilt = new Keyring([
			{ id: 1, key: Buffer.from(unwrapped, "base64") },
		]);
		expect(openField(rebuilt, sealed, cell)).toBe("Check");
		// Same id, other bytes: the tag check fails.
		await expectCode(
			Promise.resolve().then(() => openField(master(7), row.wrappedKey, aad)),
			"auth_failed",
		);
		await expectCode(keyringOf(me, master(7)), "auth_failed");
	});

	it("still opens after the master key rotates to a new first key", async () => {
		const me = await createTestUser();
		const old = { id: 1, key: randomBytes(32) };
		const before = await keyringOf(me, new Keyring([old]));
		const sealed = sealField(before, "Kept", cell);

		const rotated = new Keyring([{ id: 2, key: randomBytes(32) }, old]);
		const after = await keyringOf(me, rotated);
		expect(openField(after, sealed, cell)).toBe("Kept");
	});

	it("refuses without a master key and writes nothing", async () => {
		const me = await createTestUser();
		// getMasterKeyring() is undefined in the test environment.
		await expectDataKeyError(keyringOf(me, undefined), "master_key_missing");
		expect(await rowsOf(me.user.id)).toHaveLength(0);
	});

	it("says so plainly when the keystore is missing", async () => {
		const me = await createTestUser();
		await renameKeystore("keystore", "keystore_gone");
		try {
			await expectDataKeyError(keyringOf(me, master()), "keystore_missing");
			await expectDataKeyError(destroyDataKeys(me.user.id), "keystore_missing");
		} finally {
			await renameKeystore("keystore_gone", "keystore");
		}
	});
});

describe("who can reach which key", () => {
	const readFunction = (tx: { $queryRaw: typeof adminDb.$queryRaw }) =>
		tx.$queryRaw<{ user_id: string }[]>`
			SELECT "user_id" FROM keystore."current_user_data_keys"()`;

	it("shows a scoped caller only its own key", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		const keyA = await keyringOf(a, mk);
		const keyB = await keyringOf(b, mk);

		const seenByA = await a.db.$transaction((tx) => readFunction(tx));
		expect(seenByA.map((r) => r.user_id)).toEqual([a.user.id]);
		const seenByB = await b.db.$transaction((tx) => readFunction(tx));
		expect(seenByB.map((r) => r.user_id)).toEqual([b.user.id]);
		// And the keys that came back are the right ones.
		await expectCode(
			Promise.resolve().then(() =>
				openField(keyB, sealField(keyA, "A", cell), cell),
			),
			"auth_failed",
		);
	});

	it("gives a scoped caller no way to the table or to another user's row", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		await keyringOf(a, mk);
		await keyringOf(b, mk);

		const denied = /permission denied/i;
		await expect(
			a.db.$transaction(
				(tx) => tx.$queryRaw`SELECT * FROM keystore."user_data_key"`,
			),
		).rejects.toThrow(denied);
		await expect(
			a.db.$transaction(
				(tx) =>
					tx.$queryRaw`SELECT "wrappedKey" FROM keystore."user_data_key" WHERE "userId" = ${b.user.id}`,
			),
		).rejects.toThrow(denied);
		await expect(
			a.db.$transaction(
				(tx) =>
					tx.$executeRaw`INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId") VALUES (${b.user.id}, 2, 'x', 1)`,
			),
		).rejects.toThrow(denied);
		await expect(
			a.db.$transaction(
				(tx) =>
					tx.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${b.user.id}`,
			),
		).rejects.toThrow(denied);
		// A's call to the insert function writes only A's row, never B's.
		await a.db.$transaction(
			(tx) =>
				tx.$queryRaw`SELECT * FROM keystore."create_first_data_key"('other', 1)`,
		);
		expect(await rowsOf(a.user.id)).toHaveLength(1);
		expect(await rowsOf(b.user.id)).toHaveLength(1);
		expect((await rowsOf(b.user.id))[0]?.wrappedKey).not.toBe("other");
	});

	it("refuses when the transaction has no signed-in user", async () => {
		const me = await createTestUser();
		await keyringOf(me, master());
		const refusal = /no signed-in user/;

		// A bare raw query on the scoped client is refused before it reaches
		// the database.
		expect(() => readFunction(me.db)).toThrow(
			/not allowed on a user-scoped client/,
		);
		// An owner transaction with the setting empty.
		await expect(
			adminDb.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', '', true)`;
				return readFunction(tx);
			}),
		).rejects.toThrow(refusal);
		await expect(
			adminDb.$transaction(
				(tx) =>
					tx.$queryRaw`SELECT * FROM keystore."create_first_data_key"('x', 1)`,
			),
		).rejects.toThrow(refusal);
		// And through the service.
		await expectDataKeyError(
			adminDb.$transaction((tx) => getOrCreateDataKeyring(tx, master())),
			"no_user",
		);
	});

	it("refuses to make a key for a user that does not exist", async () => {
		const ghost = randomUUID();
		await expectDataKeyError(
			userTransaction(adminDb, ghost, (tx) =>
				getOrCreateDataKeyring(tx, master()),
			),
			"no_user",
		);
		expect(await rowsOf(ghost)).toHaveLength(0);
	});
});

describe("keystore grants", () => {
	const functions = [
		'keystore."current_user_data_keys"()',
		'keystore."create_first_data_key"(text, bigint)',
		'public."keystore_drop_user_keys"()',
	];
	const has = async (sql: string) =>
		(await adminDb.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT ${sql} AS ok`))[0]
			?.ok;

	it("keeps every keystore function away from PUBLIC", async () => {
		for (const fn of functions)
			expect(
				await has(`has_function_privilege('public', '${fn}', 'EXECUTE')`),
			).toBe(false);
		// The signed-in role gets the two doors and not the trigger function.
		expect(
			await has(
				`has_function_privilege('retrospend_app', '${functions[0]}', 'EXECUTE')`,
			),
		).toBe(true);
		expect(
			await has(
				`has_function_privilege('retrospend_app', '${functions[1]}', 'EXECUTE')`,
			),
		).toBe(true);
		expect(
			await has(
				`has_function_privilege('retrospend_app', '${functions[2]}', 'EXECUTE')`,
			),
		).toBe(false);
	});

	it("gives the app role and PUBLIC no privilege on the table", async () => {
		for (const role of ["retrospend_app", "public"])
			for (const privilege of [
				"SELECT",
				"INSERT",
				"UPDATE",
				"DELETE",
				"TRUNCATE",
				"REFERENCES",
				"TRIGGER",
			])
				expect(
					await has(
						`has_table_privilege('${role}', 'keystore.user_data_key', '${privilege}')`,
					),
				).toBe(false);
	});

	it("names a lost grant instead of a raw permission error", async () => {
		const me = await createTestUser();
		await adminDb.$executeRawUnsafe(
			'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
		);
		try {
			await expectDataKeyError(
				keyringOf(me, master()),
				"keystore_grants_missing",
			);
		} finally {
			await adminDb.$executeRawUnsafe(
				'GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app',
			);
		}
		expect(await keyringOf(me, master())).toBeInstanceOf(Keyring);
	});
});

describe("create_first_data_key and a user delete", () => {
	it("holds the user row, so a delete waits and then takes the new key", async () => {
		const me = await createTestUser();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const holder = me.db.$transaction(async (tx) => {
			await getOrCreateDataKeyring(tx, master());
			started();
			await gate;
		});
		await ready;

		// While that transaction is open the delete cannot take the row. Without
		// the FOR KEY SHARE lock in the function it would go through at once
		// and leave the new key behind.
		const blocked = await failure(
			adminDb.$transaction(async (tx) => {
				await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
				await tx.$executeRaw`DELETE FROM "user" WHERE id = ${me.user.id}`;
			}),
		);
		expect(String(blocked)).toMatch(/lock timeout|55P03/i);

		release();
		await holder;
		await adminDb.user.delete({ where: { id: me.user.id } });
		expect(await rowsOf(me.user.id)).toHaveLength(0);
	});
});

describe("destroyDataKeys", () => {
	it("removes the user's key, leaves others, and strands old ciphertext", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		const keyA = await keyringOf(a, mk);
		const keyB = await keyringOf(b, mk);
		const sealedA = sealField(keyA, "Gone", cell);
		const sealedB = sealField(keyB, "Stays", cell);

		expect(await destroyDataKeys(a.user.id)).toBe(1);
		expect(await destroyDataKeys(a.user.id)).toBe(0);
		expect(await rowsOf(a.user.id)).toHaveLength(0);
		expect(await rowsOf(b.user.id)).toHaveLength(1);

		// The marker says A had a key, so no new one is made until an operator
		// clears it (see "keys that were lost" below).
		await expectDataKeyError(keyringOf(a, mk), "keystore_lost");
		await clearMarker(a.user.id);
		const reborn = await keyringOf(a, mk);
		await expectCode(
			Promise.resolve().then(() => openField(reborn, sealedA, cell)),
			"auth_failed",
		);
		expect(openField(keyB, sealedB, cell)).toBe("Stays");
	});

	it("is dropped with the user row, whoever deletes it", async () => {
		const me = await createTestUser();
		await keyringOf(me, master());
		await adminDb.user.delete({ where: { id: me.user.id } });
		expect(await rowsOf(me.user.id)).toHaveLength(0);
	});

	it("is dropped when a role without keystore access deletes the user", async () => {
		const me = await createTestUser();
		const other = await createTestUser();
		await keyringOf(me, master());
		await keyringOf(other, master());
		// "user" has row-level security, so the probe bypasses it: the test is
		// about the keystore, not about who may delete which user. Creating a
		// role needs the superuser; the transaction is rolled back.
		await withSuperuser(async (client) => {
			await client.query("BEGIN");
			try {
				await client.query("CREATE ROLE keystore_probe BYPASSRLS");
				await client.query('GRANT SELECT, DELETE ON "user" TO keystore_probe');
				await client.query("SET LOCAL ROLE keystore_probe");
				await client.query('DELETE FROM "user" WHERE id = $1', [me.user.id]);
				await client.query("RESET ROLE");
				const left = await client.query<{ n: string }>(
					'SELECT count(*) AS n FROM keystore."user_data_key" WHERE "userId" = $1',
					[me.user.id],
				);
				expect(Number(left.rows[0]?.n)).toBe(0);
			} finally {
				await client.query("ROLLBACK");
			}
		});
	});

	it("never blocks a user delete when the keystore is missing", async () => {
		const me = await createTestUser();
		await renameKeystore("keystore", "keystore_gone");
		try {
			await adminDb.user.delete({ where: { id: me.user.id } });
		} finally {
			await renameKeystore("keystore_gone", "keystore");
		}
		expect(
			await adminDb.user.findUnique({ where: { id: me.user.id } }),
		).toBeNull();
	});
});

describe("keys that were lost", () => {
	it("sets the marker with the first key, once", async () => {
		const me = await createTestUser();
		expect(await markerOf(me.user.id)).toBeNull();
		const mk = master();
		const before = Date.now();
		await keyringOf(me, mk);
		const first = await markerOf(me.user.id);
		expect(first).toBeInstanceOf(Date);
		// The marker is the time of the mint (UTC, to the millisecond).
		expect(Math.abs((first?.getTime() ?? 0) - before)).toBeLessThan(10_000);

		await keyringOf(me, mk);
		expect(await markerOf(me.user.id)).toEqual(first);
		expect(await rowsOf(me.user.id)).toHaveLength(1);
	});

	it("refuses a new first key when the marker is set and the key row is gone", async () => {
		const me = await createTestUser();
		const mk = master();
		const sealed = sealField(await keyringOf(me, mk), "Kept", cell);
		const marker = await markerOf(me.user.id);
		// A main dump restored without the keystore: the marker stays, the key goes.
		await withSuperuser((client) =>
			client.query('DELETE FROM keystore."user_data_key" WHERE "userId" = $1', [
				me.user.id,
			]),
		);

		await expectDataKeyError(keyringOf(me, mk), "keystore_lost");
		// It made nothing, and again the next time.
		expect(await rowsOf(me.user.id)).toHaveLength(0);
		await expectDataKeyError(keyringOf(me, mk), "keystore_lost");
		expect(await markerOf(me.user.id)).toEqual(marker);

		// The error names no user and no key.
		const error = await failure(keyringOf(me, mk));
		expect((error as Error).message).not.toContain(me.user.id);

		// An operator who accepts the loss clears the marker; a key is made
		// again and it does not open what the first one sealed.
		await clearMarker(me.user.id);
		const reborn = await keyringOf(me, mk);
		expect(await rowsOf(me.user.id)).toHaveLength(1);
		await expectCode(
			Promise.resolve().then(() => openField(reborn, sealed, cell)),
			"auth_failed",
		);
		expect(await markerOf(me.user.id)).not.toBeNull();
	});

	it("keeps a loss from touching the other users", async () => {
		const [lost, fine, fresh] = await Promise.all([
			createTestUser(),
			createTestUser(),
			createTestUser(),
		]);
		const mk = master();
		await keyringOf(lost, mk);
		const keyFine = await keyringOf(fine, mk);
		await destroyDataKeys(lost.user.id);

		await expectDataKeyError(keyringOf(lost, mk), "keystore_lost");
		const again = await keyringOf(fine, mk);
		expect(again.ids).toEqual(keyFine.ids);
		// A user who never had a key (marker empty) still gets one.
		expect(await keyringOf(fresh, mk)).toBeInstanceOf(Keyring);
	});

	it("still hands out the keys a user has, even with the marker cleared", async () => {
		const me = await createTestUser();
		const mk = master();
		const first = await keyringOf(me, mk);
		await clearMarker(me.user.id);
		const again = await keyringOf(me, mk);
		expect(again.ids).toEqual(first.ids);
		// The read path made nothing, so the marker stays empty until a mint.
		expect(await markerOf(me.user.id)).toBeNull();
		expect(await rowsOf(me.user.id)).toHaveLength(1);
	});

	it("stamps the marker when the function runs for a key that already exists", async () => {
		const me = await createTestUser();
		const mk = master();
		const key = await keyringOf(me, mk);
		await clearMarker(me.user.id);
		// A racing caller (or a key from before the marker) reaches the insert,
		// which is a no-op, and the marker is set all the same.
		await userTransaction(
			adminDb,
			me.user.id,
			(tx) =>
				tx.$queryRaw`
				SELECT * FROM keystore."create_first_data_key"(${sealField(mk, "x", cell)}, 1::bigint)`,
		);
		expect(await markerOf(me.user.id)).not.toBeNull();
		expect(await rowsOf(me.user.id)).toHaveLength(1);
		expect((await keyringOf(me, mk)).ids).toEqual(key.ids);
	});

	it("deletes a user in every state: with a key, with a lost key, and with no marker", async () => {
		const [withKey, lost, never] = await Promise.all([
			createTestUser(),
			createTestUser(),
			createTestUser(),
		]);
		const mk = master();
		await keyringOf(withKey, mk);
		await keyringOf(lost, mk);
		await destroyDataKeys(lost.user.id);

		for (const who of [withKey, lost, never])
			await adminDb.user.delete({ where: { id: who.user.id } });
		for (const who of [withKey, lost, never]) {
			expect(await rowsOf(who.user.id)).toHaveLength(0);
			expect(
				await adminDb.user.findUnique({ where: { id: who.user.id } }),
			).toBeNull();
		}
		// A deleted user has no row to carry a marker, so nothing is minted.
		await expectDataKeyError(
			userTransaction(adminDb, withKey.user.id, (tx) =>
				getOrCreateDataKeyring(tx, mk),
			),
			"no_user",
		);
		expect(await rowsOf(withKey.user.id)).toHaveLength(0);
	});

	it("keeps the function's security settings and the app role's reach", async () => {
		const [fn] = await adminDb.$queryRaw<
			{ secdef: boolean; config: string[]; app: boolean; pub: boolean }[]
		>`
			SELECT p.prosecdef AS secdef, p.proconfig AS config,
			       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS app,
			       has_function_privilege('public', p.oid, 'EXECUTE') AS pub
			FROM pg_proc p
			WHERE p.proname = 'create_first_data_key' AND p.pronamespace = 'keystore'::regnamespace`;
		expect(fn).toEqual({
			secdef: true,
			config: ["search_path=pg_catalog, pg_temp"],
			app: true,
			pub: false,
		});
		// The app role can neither read nor write the marker.
		const [priv] = await adminDb.$queryRaw<{ read: boolean; write: boolean }[]>`
			SELECT has_column_privilege('retrospend_app', '"user"', 'dataKeySince', 'SELECT') AS read,
			       has_column_privilege('retrospend_app', '"user"', 'dataKeySince', 'UPDATE') AS write`;
		expect(priv).toEqual({ read: false, write: false });
	});

	it("a signed-in user cannot clear their own marker", async () => {
		const me = await createTestUser();
		await keyringOf(me, master());
		await expect(
			me.db.user.update({
				where: { id: me.user.id },
				data: { dataKeySince: null },
				select: { id: true },
			}),
		).rejects.toThrow();
		expect(await markerOf(me.user.id)).not.toBeNull();
	});

	it("the migration file runs again safely and gives existing keys a marker", async () => {
		const me = await createTestUser();
		await keyringOf(me, master());
		const migrationSql = readFileSync(
			join(
				REPO_ROOT,
				"prisma/migrations/20261109800000_keystore_lost_guard/migration.sql",
			),
			"utf8",
		);
		// Replayed inside a transaction that is rolled back, so the worker's
		// catalog stays as the template left it.
		await inRolledBackTransaction(async (client) => {
			// Compared in SQL: node-postgres reads a timestamp without a zone as local time.
			const markerIsKeyTime = async () =>
				(
					await client.query<{ same: boolean }>(
						`SELECT u."dataKeySince" = k."createdAt" AS same
						 FROM "user" u JOIN keystore."user_data_key" k ON k."userId" = u.id
						 WHERE u.id = $1`,
						[me.user.id],
					)
				).rows[0]?.same;
			await client.query(
				'UPDATE "user" SET "dataKeySince" = NULL WHERE id = $1',
				[me.user.id],
			);
			await client.query(migrationSql);
			await client.query(migrationSql);
			expect(await markerIsKeyTime()).toBe(true);
			// The replaced function still refuses a lost key.
			await client.query(
				'DELETE FROM keystore."user_data_key" WHERE "userId" = $1',
				[me.user.id],
			);
			await client.query("SAVEPOINT lost");
			await client.query("SELECT set_config('app.current_user_id', $1, true)", [
				me.user.id,
			]);
			await expect(
				client.query(
					"SELECT * FROM keystore.create_first_data_key('x', 1::bigint)",
				),
			).rejects.toMatchObject({ code: "KS001" });
			await client.query("ROLLBACK TO SAVEPOINT lost");
		});
	});

	it("the documented recovery for a missing keystore ends with the guarded function", async () => {
		// docs/self-hosting.md: delete these rows, and start the app, which runs
		// the migrations again in order. The test replays exactly that list.
		const doc = readFileSync(join(REPO_ROOT, "docs/self-hosting.md"), "utf8");
		const listed =
			/DELETE FROM _prisma_migrations WHERE migration_name IN \(([^)]*)\)/.exec(
				doc,
			)?.[1];
		const names = [...(listed ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
		expect(names).toEqual([
			"20261109100000_keystore",
			"20261109800000_keystore_lost_guard",
			"20261111100000_instance_text_key",
		]);
		const migration = (name: string) =>
			readFileSync(
				join(REPO_ROOT, "prisma/migrations", name, "migration.sql"),
				"utf8",
			);

		const me = await createTestUser();
		await keyringOf(me, master());
		await inRolledBackTransaction(async (client) => {
			const mint = async () => {
				await client.query("SAVEPOINT mint");
				await client.query(
					"SELECT set_config('app.current_user_id', $1, true)",
					[me.user.id],
				);
				try {
					await client.query(
						"SELECT * FROM keystore.create_first_data_key('x', 1::bigint)",
					);
					return "minted";
				} catch (error) {
					return (error as { code?: string }).code;
				} finally {
					await client.query("ROLLBACK TO SAVEPOINT mint");
				}
			};
			// The keystore was lost: the key row is gone, the marker stays.
			await client.query(
				'DELETE FROM keystore."user_data_key" WHERE "userId" = $1',
				[me.user.id],
			);
			expect(await mint()).toBe("KS001");

			// Running only the first migration again brings back the old function.
			await client.query(migration(names[0] ?? ""));
			expect(await mint()).toBe("minted");

			// The documented list runs both, in order, and the guard is back.
			for (const name of names) await client.query(migration(name ?? ""));
			expect(await mint()).toBe("KS001");
		});
	});
});
