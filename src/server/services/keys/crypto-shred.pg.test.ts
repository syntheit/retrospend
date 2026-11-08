/**
 * Crypto-shred on account deletion (lane D3). A deleted account's data keys go
 * in the same transaction as its user row, so anything sealed with them can
 * never be read again. Hand-derived expectations:
 *
 *   self-service delete            -> 0 keystore rows, sealed text unreadable
 *   admin delete (/api/v1/admin)   -> the same
 *   user row back under the same id-> a new key, so the old text still fails
 *   a bystander's key              -> untouched, still opens its own text
 *   user with no key               -> delete works
 *   failure after the key destroy  -> key row, user row and text all remain
 *   keystore trigger disabled      -> the explicit call still destroys the key
 *
 * Until D12 backfills, most stored rows are plaintext and shredding destroys
 * nothing for them; these tests cover only text that was sealed.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asKey, call } from "~/server/api/v1/core/__tests__/harness";
import { auth } from "~/server/better-auth";
import {
	type FieldAad,
	FieldCryptoError,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { userTransaction } from "~/server/db-tx";
import { deleteOwnAccount } from "~/server/services/account-deletion.service";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import { adminDb, createTestUser, withSuperuser } from "~/test/pg-harness";
import { DataKeyError, getOrCreateDataKeyring } from "./data-key.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	deleteFile: vi.fn(async () => undefined),
}));

const PASSWORD = "correct horse battery";
const master = new Keyring([{ id: 1, key: randomBytes(32) }]);
const cell: FieldAad = { table: "expense", column: "title", rowId: "e1" };

/** A user who can sign in, so the self-service delete can check the password. */
async function passwordUser() {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Dana",
			username: `d${randomBytes(6).toString("hex")}`,
		},
	});
	return user.id;
}

/** What a signed-in request does: the user's own transaction. */
const keyringOf = (userId: string) =>
	userTransaction(adminDb, userId, (tx) => getOrCreateDataKeyring(tx, master));

const keyRows = async (userId: string) =>
	(
		await adminDb.$queryRaw<{ n: bigint }[]>`
			SELECT count(*) AS n FROM keystore."user_data_key" WHERE "userId" = ${userId}`
	)[0]?.n;

const userExists = async (id: string) =>
	(await adminDb.user.findUnique({ where: { id } })) !== null;

/** Gives the user a key and returns text sealed with it. */
async function sealFor(userId: string, text = "Coffee") {
	return sealField(await keyringOf(userId), text, cell);
}

async function expectUnreadable(userId: string, sealed: string) {
	// There is no user left to mint a key for, so the read refuses.
	await expect(keyringOf(userId)).rejects.toBeInstanceOf(DataKeyError);
	// Even a user row back under the same id gets a new, unrelated key.
	await adminDb.user.create({
		data: {
			id: userId,
			name: "Back",
			username: `back_${userId.replaceAll("-", "").toLowerCase()}`,
			email: `${userId}@pg-test.invalid`,
		},
	});
	try {
		const fresh = await keyringOf(userId);
		const error = await Promise.resolve()
			.then(() => openField(fresh, sealed, cell))
			.then(
				() => undefined,
				(e: unknown) => e,
			);
		expect(error).toBeInstanceOf(FieldCryptoError);
		expect((error as FieldCryptoError).code).toBe("auth_failed");
	} finally {
		await adminDb.user.delete({ where: { id: userId } });
	}
}

describe("crypto-shred on account deletion", () => {
	let bystander: string;
	let bystanderSealed: string;

	beforeAll(async () => {
		bystander = (await createTestUser()).user.id;
		bystanderSealed = await sealFor(bystander, "Not yours");
	});

	afterAll(async () => {
		await adminDb.user.deleteMany({ where: { id: bystander } });
	});

	const bystanderIntact = async () => {
		expect(await keyRows(bystander)).toBe(1n);
		expect(openField(await keyringOf(bystander), bystanderSealed, cell)).toBe(
			"Not yours",
		);
	};

	it("destroys the key when the user deletes their own account", async () => {
		const id = await passwordUser();
		const sealed = await sealFor(id);
		expect(await keyRows(id)).toBe(1n);

		await deleteOwnAccount({ id, role: "USER" }, PASSWORD);

		expect(await userExists(id)).toBe(false);
		expect(await keyRows(id)).toBe(0n);
		await expectUnreadable(id, sealed);
		await bystanderIntact();
	});

	it("destroys the key when an admin deletes the account", async () => {
		const admin = (await createTestUser({ role: "ADMIN" })).user.id;
		const id = (await createTestUser()).user.id;
		const sealed = await sealFor(id);

		const res = await call(`/admin/users/${id}`, {
			method: "DELETE",
			headers: await asKey(admin, ["admin"]),
			idempotent: true,
		});

		expect(res.status).toBe(200);
		expect(await userExists(id)).toBe(false);
		expect(await keyRows(id)).toBe(0n);
		await expectUnreadable(id, sealed);
		await bystanderIntact();
		await adminDb.user.delete({ where: { id: admin } });
	});

	it("deletes an account that never had a key", async () => {
		const id = (await createTestUser()).user.id;
		expect(await keyRows(id)).toBe(0n);

		await anonymizeAndDeleteUser(adminDb, id, `${id}@pg-test.invalid`, null);

		expect(await userExists(id)).toBe(false);
		await bystanderIntact();
	});

	it("keeps the key when the deletion fails after the key destroy", async () => {
		const id = (await createTestUser()).user.id;
		const sealed = await sealFor(id);
		const boom = new Error("user delete failed");
		// Fails at the user delete, the step right after the explicit destroy, so
		// only a destroy that is part of this transaction can leave the row gone.
		const failing = {
			$transaction: (fn: (tx: unknown) => Promise<unknown>) =>
				adminDb.$transaction((tx) =>
					fn(
						new Proxy(tx, {
							get(target, prop) {
								if (prop === "user")
									return {
										delete: async () => {
											throw boom;
										},
									};
								const value = Reflect.get(target, prop, target);
								return typeof value === "function" ? value.bind(target) : value;
							},
						}),
					),
				),
		};

		await expect(
			anonymizeAndDeleteUser(
				failing as never,
				id,
				`${id}@pg-test.invalid`,
				null,
			),
		).rejects.toBe(boom);

		expect(await userExists(id)).toBe(true);
		expect(await keyRows(id)).toBe(1n);
		expect(openField(await keyringOf(id), sealed, cell)).toBe("Coffee");
		await adminDb.user.delete({ where: { id } });
	});

	it("destroys the key by the explicit call when the keystore trigger is gone", async () => {
		const id = (await createTestUser()).user.id;
		const sealed = await sealFor(id);
		const trigger = (state: "DISABLE" | "ENABLE") =>
			withSuperuser((client) =>
				client.query(
					`ALTER TABLE public."user" ${state} TRIGGER "keystore_user_delete"`,
				),
			);
		await trigger("DISABLE");
		try {
			await anonymizeAndDeleteUser(adminDb, id, `${id}@pg-test.invalid`, null);
			expect(await keyRows(id)).toBe(0n);
		} finally {
			await trigger("ENABLE");
		}
		await expectUnreadable(id, sealed);
	});
});
