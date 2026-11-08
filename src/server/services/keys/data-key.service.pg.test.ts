/**
 * Per-user data keys in the keystore schema. Hand-derived expectations:
 *
 *   one user, two calls            -> one row, the same key both times
 *   eight concurrent first calls   -> one row, one key
 *   user A's key opens B's text    -> never (auth_failed)
 *   A's wrapped key copied to B    -> does not open (AAD names the user)
 *   destroy                        -> row count 1, then 0; old text unreadable
 *   master key with the same id but other bytes -> the wrapped key fails
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	DataKeyError,
	destroyDataKeys,
	getOrCreateDataKeyring,
} from "./data-key.service";

const master = (id = 1) => new Keyring([{ id, key: randomBytes(32) }]);
const cell: FieldAad = { table: "expense", column: "title", rowId: "e1" };

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

async function expectCode(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(FieldCryptoError);
	expect((error as FieldCryptoError).code).toBe(code);
}

describe("getOrCreateDataKeyring", () => {
	it("makes one key on first use and returns the same key after", async () => {
		const { user } = await createTestUser();
		const mk = master();
		const first = await getOrCreateDataKeyring(user.id, mk);
		const second = await getOrCreateDataKeyring(user.id, mk);

		const sealed = sealField(first, "Coffee", cell);
		expect(openField(second, sealed, cell)).toBe("Coffee");
		const rows = await rowsOf(user.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.keyId).toBe(1);
	});

	it("is idempotent when callers race on the first use", async () => {
		const { user } = await createTestUser();
		const mk = master();
		const keyrings = await Promise.all(
			Array.from({ length: 8 }, () =>
				getOrCreateDataKeyring(user.id, mk),
			),
		);

		expect(await rowsOf(user.id)).toHaveLength(1);
		const sealed = sealField(keyrings[0] as Keyring, "Rent", cell);
		for (const keyring of keyrings)
			expect(openField(keyring, sealed, cell)).toBe("Rent");
	});

	it("gives each user their own key", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		const keyA = await getOrCreateDataKeyring(a.user.id, mk);
		const keyB = await getOrCreateDataKeyring(b.user.id, mk);

		const sealed = sealField(keyA, "Only A", cell);
		await expectCode(
			Promise.resolve().then(() => openField(keyB, sealed, cell)),
			"auth_failed",
		);
	});

	it("does not open a wrapped key copied to another user", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		await getOrCreateDataKeyring(a.user.id, mk);
		const [row] = await rowsOf(a.user.id);
		await adminDb.$executeRaw`
			INSERT INTO keystore."user_data_key" ("userId", "keyId", "wrappedKey", "masterKeyId")
			VALUES (${b.user.id}, 1, ${row?.wrappedKey}, 1)`;

		await expectCode(
			getOrCreateDataKeyring(b.user.id, mk),
			"auth_failed",
		);
	});

	it("stores a key that opens with the master key and with no other", async () => {
		const { user } = await createTestUser();
		const mk = master(7);
		const keyring = await getOrCreateDataKeyring(user.id, mk);
		const [row] = await rowsOf(user.id);
		if (!row) throw new Error("no row");

		expect(Number(row.masterKeyId)).toBe(7);
		const aad = {
			table: "keystore.user_data_key",
			column: "wrappedKey",
			rowId: `${user.id}:1`,
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
		await expectCode(
			getOrCreateDataKeyring(user.id, master(7)),
			"auth_failed",
		);
	});

	it("still opens after the master key rotates to a new first key", async () => {
		const { user } = await createTestUser();
		const old = { id: 1, key: randomBytes(32) };
		const before = await getOrCreateDataKeyring(user.id, new Keyring([old]));
		const sealed = sealField(before, "Kept", cell);

		const rotated = new Keyring([{ id: 2, key: randomBytes(32) }, old]);
		const after = await getOrCreateDataKeyring(user.id, rotated);
		expect(openField(after, sealed, cell)).toBe("Kept");
	});

	it("refuses without a master key and writes nothing", async () => {
		const { user } = await createTestUser();
		// getMasterKeyring() is undefined in the test environment.
		const error = await getOrCreateDataKeyring(user.id, undefined).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(DataKeyError);
		expect((error as DataKeyError).code).toBe("master_key_missing");
		expect(await rowsOf(user.id)).toHaveLength(0);
	});

	it("leaves the app role no way into the keystore", async () => {
		const { user, db } = await createTestUser();
		await getOrCreateDataKeyring(user.id, master());

		// A scoped transaction runs raw SQL as retrospend_app, and it is denied.
		// (A bare raw query on the scoped client runs on the owner connection,
		// which is why the service takes no client and the grants are the guard.)
		await expect(
			db.$transaction(
				(tx) => tx.$queryRaw`SELECT * FROM keystore."user_data_key"`,
			),
		).rejects.toThrow(/permission denied/i);
		await expect(
			db.$transaction(
				(tx) =>
					tx.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${user.id}`,
			),
		).rejects.toThrow(/permission denied/i);
		expect(await rowsOf(user.id)).toHaveLength(1);
	});

	it("says so plainly when the keystore is missing", async () => {
		const { user } = await createTestUser();
		await adminDb.$executeRawUnsafe("ALTER SCHEMA keystore RENAME TO keystore_gone");
		try {
			const error = await getOrCreateDataKeyring(user.id, master()).catch(
				(e: unknown) => e,
			);
			expect(error).toBeInstanceOf(DataKeyError);
			expect((error as DataKeyError).code).toBe("keystore_missing");
			const destroyed = await destroyDataKeys(user.id).catch((e: unknown) => e);
			expect((destroyed as DataKeyError).code).toBe("keystore_missing");
		} finally {
			await adminDb.$executeRawUnsafe("ALTER SCHEMA keystore_gone RENAME TO keystore");
		}
	});
});

describe("destroyDataKeys", () => {
	it("removes the user's key, leaves others, and strands old ciphertext", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const mk = master();
		const keyA = await getOrCreateDataKeyring(a.user.id, mk);
		const keyB = await getOrCreateDataKeyring(b.user.id, mk);
		const sealedA = sealField(keyA, "Gone", cell);
		const sealedB = sealField(keyB, "Stays", cell);

		expect(await destroyDataKeys(a.user.id)).toBe(1);
		expect(await destroyDataKeys(a.user.id)).toBe(0);
		expect(await rowsOf(a.user.id)).toHaveLength(0);
		expect(await rowsOf(b.user.id)).toHaveLength(1);

		const reborn = await getOrCreateDataKeyring(a.user.id, mk);
		await expectCode(
			Promise.resolve().then(() => openField(reborn, sealedA, cell)),
			"auth_failed",
		);
		expect(openField(keyB, sealedB, cell)).toBe("Stays");
	});

	it("is dropped with the user row, whoever deletes it", async () => {
		const { user } = await createTestUser();
		await getOrCreateDataKeyring(user.id, master());
		await adminDb.user.delete({ where: { id: user.id } });
		expect(await rowsOf(user.id)).toHaveLength(0);
	});

	it("is dropped when a role without keystore access deletes the user", async () => {
		const { user } = await createTestUser();
		const other = await createTestUser();
		await getOrCreateDataKeyring(user.id, master());
		await getOrCreateDataKeyring(other.user.id, master());
		const rollback = new Error("rollback");
		await adminDb
			.$transaction(async (tx) => {
				await tx.$executeRawUnsafe("CREATE ROLE keystore_probe");
				await tx.$executeRawUnsafe('GRANT SELECT, DELETE ON "user" TO keystore_probe');
				await tx.$executeRawUnsafe("SET LOCAL ROLE keystore_probe");
				await tx.$executeRaw`DELETE FROM "user" WHERE id = ${user.id}`;
				await tx.$executeRawUnsafe("RESET ROLE");
				const left = await tx.$queryRaw<{ n: bigint }[]>`
					SELECT count(*) AS n FROM keystore."user_data_key" WHERE "userId" = ${user.id}`;
				expect(Number(left[0]?.n)).toBe(0);
				throw rollback;
			})
			.catch((e: unknown) => {
				if (e !== rollback) throw e;
			});
	});

	it("never blocks a user delete when the keystore is missing", async () => {
		const { user } = await createTestUser();
		await adminDb.$executeRawUnsafe("ALTER SCHEMA keystore RENAME TO keystore_gone");
		try {
			await adminDb.user.delete({ where: { id: user.id } });
		} finally {
			await adminDb.$executeRawUnsafe("ALTER SCHEMA keystore_gone RENAME TO keystore");
		}
		expect(await adminDb.user.findUnique({ where: { id: user.id } })).toBeNull();
	});
});
