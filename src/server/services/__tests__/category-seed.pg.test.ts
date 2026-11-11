/**
 * Category inserts and the first-write key mint (E2EE D11 PR 4.1,
 * docs/roadmap/e2ee-d11-pr4.md sections 1 and 5, critic round 2 A and B).
 * Hand-derived expectations:
 *
 *   sign-up seed, master key set          -> every default name, each with a current-tag index; again: 0 more
 *   sign-up seed, no master key           -> every default name, no index, no key made (sealing off or on)
 *   sign-up seed, keystore grants revoked -> every default name, no index, no error (sealing off or on)
 *   income categories after the defaults  -> 6 - 1 ("Gifts" is taken) = 5, indexed; again: same rows, same bytes
 *   ensure, sealing off                   -> no key
 *   ensure, sealing on, 5 at once         -> one key, one ring
 *   ensure inside a transaction           -> refused
 *   ensure after a crypto-shred           -> no new key (keystore_lost), the caller is not failed
 *   a signed-in tRPC or v1 call           -> mints the caller's key only when sealing
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import {
	createCallerFactory,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { asMobile, call } from "~/server/api/v1/core/__tests__/harness";
import { blindIndexTag } from "~/server/crypto/blind-index";
import type { Keyring } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { newMasterKeyring, userKeyring } from "~/test/sealed-fixture";
import { makeSession } from "~/test/trpc-test-utils";
import { createCategory, seedDefaultCategories } from "../category.service";
import { CATEGORY_NAME_INDEX_LABEL } from "../category-name-index.service";
import {
	destroyDataKeys,
	ensureUserKeyring,
	ensureUserKeyringWhenSealing,
	findDataKeyring,
} from "../keys/data-key.service";
import { ensureIncomeCategories, INCOME_CATEGORIES } from "../money-in.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

let masterKey: Keyring;
beforeAll(() => {
	masterKey = newMasterKeyring();
	master.ring = masterKey;
});
afterEach(() => {
	master.ring = masterKey;
	setSealingForTests();
	vi.restoreAllMocks();
});

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const keyCount = async (userId: string) => {
	const [row] = await adminDb.$queryRaw<{ n: bigint }[]>`
		SELECT count(*) AS n FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
	return Number(row?.n);
};

const categories = (userId: string) =>
	adminDb.category.findMany({
		where: { userId },
		select: { id: true, name: true, nameIndex: true, kind: true },
		orderBy: { name: "asc" },
	});

const currentTag = async (u: TestUser) =>
	blindIndexTag(
		await userKeyring(u.user.id, masterKey),
		CATEGORY_NAME_INDEX_LABEL,
	);

const defaultNames = DEFAULT_CATEGORIES.map((c) => c.name).sort();

describe("the sign-up seed", () => {
	it("writes every default name with a current name index, once", async () => {
		const u = await createTestUser();
		expect(await seedDefaultCategories(adminDb, u.user.id)).toBe(
			DEFAULT_CATEGORIES.length,
		);
		const rows = await categories(u.user.id);
		expect(rows.map((r) => r.name).sort()).toEqual(defaultNames);
		const tag = await currentTag(u);
		expect(rows.every((r) => r.nameIndex?.startsWith(`${tag}:`))).toBe(true);

		expect(await seedDefaultCategories(adminDb, u.user.id)).toBe(0);
		expect(await categories(u.user.id)).toEqual(rows);
	});

	for (const sealingOn of [false, true]) {
		const label = sealingOn ? "sealing on" : "sealing off";

		it(`with no master key seeds as before, and makes no key (${label})`, async () => {
			setSealingForTests(() => sealingOn);
			master.ring = undefined;
			const u = await createTestUser();
			await seedDefaultCategories(adminDb, u.user.id);
			const rows = await categories(u.user.id);
			expect(rows.map((r) => r.name).sort()).toEqual(defaultNames);
			expect(rows.every((r) => r.nameIndex === null)).toBe(true);
			expect(await keyCount(u.user.id)).toBe(0);
		});

		it(`with the keystore grants revoked seeds as before (${label})`, async () => {
			setSealingForTests(() => sealingOn);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const u = await createTestUser();
			await adminDb.$executeRawUnsafe(
				'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
			);
			try {
				await seedDefaultCategories(adminDb, u.user.id);
			} finally {
				await adminDb.$executeRawUnsafe(
					'GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app',
				);
			}
			const rows = await categories(u.user.id);
			expect(rows.map((r) => r.name).sort()).toEqual(defaultNames);
			expect(rows.every((r) => r.nameIndex === null)).toBe(true);
			expect(await keyCount(u.user.id)).toBe(0);
		});
	}
});

describe("income categories", () => {
	it("add the names the user lacks, indexed, and a second call changes nothing", async () => {
		const u = await createTestUser();
		await seedDefaultCategories(adminDb, u.user.id);
		const income = await ensureIncomeCategories(u.db, u.user.id);
		// "Gifts" is already an expense category.
		expect(income.map((c) => c.name).sort()).toEqual(
			INCOME_CATEGORIES.map((c) => c.name)
				.filter((n) => n !== "Gifts")
				.sort(),
		);
		const tag = await currentTag(u);
		const rows = (await categories(u.user.id)).filter(
			(r) => r.kind === "INCOME",
		);
		expect(rows).toHaveLength(5);
		expect(rows.every((r) => r.nameIndex?.startsWith(`${tag}:`))).toBe(true);
		const stored = await adminDb.$queryRaw<{ id: string; name: string }[]>`
			SELECT "id", "name" FROM "category" WHERE "userId" = ${u.user.id} ORDER BY "id"`;

		// Inside a transaction (income.add) as well as on a client.
		await userTransaction(adminDb, u.user.id, (tx) =>
			ensureIncomeCategories(tx, u.user.id),
		);
		await ensureIncomeCategories(u.db, u.user.id);
		expect(
			await adminDb.$queryRaw`
				SELECT "id", "name" FROM "category" WHERE "userId" = ${u.user.id} ORDER BY "id"`,
		).toEqual(stored);
	});
});

describe("the first-write key mint", () => {
	it("makes no key while sealing is off", async () => {
		const u = await createTestUser();
		await ensureUserKeyringWhenSealing(u.user.id);
		expect(await keyCount(u.user.id)).toBe(0);
	});

	it("makes no key when told there is no master key, even with one set", async () => {
		setSealingForTests(() => true);
		const u = await createTestUser();
		await ensureUserKeyringWhenSealing(u.user.id, null);
		expect(await keyCount(u.user.id)).toBe(0);
	});

	it("makes one key for concurrent first writes, outside any transaction", async () => {
		setSealingForTests(() => true);
		const u = await createTestUser();
		const rings = await Promise.all(
			Array.from({ length: 5 }, () => ensureUserKeyring(u.user.id)),
		);
		expect(new Set(rings).size).toBe(1);
		expect(await keyCount(u.user.id)).toBe(1);
		await expect(
			userTransaction(adminDb, u.user.id, () => ensureUserKeyring(u.user.id)),
		).rejects.toThrow(/before a transaction/);
	});

	it("runs before a category create when sealing, so the create finds the key", async () => {
		setSealingForTests(() => true);
		const u = await createTestUser();
		const made = await createCategory(adminDb, u.user.id, {
			name: "Rent",
			color: "orange",
		});
		expect(await keyCount(u.user.id)).toBe(1);
		const [row] = (await categories(u.user.id)).filter((r) => r.id === made.id);
		expect(row?.nameIndex?.startsWith(`${await currentTag(u)}:`)).toBe(true);
	});

	it("drops a cached 'no key' when a key is made inside a transaction (D9)", async () => {
		const u = await createTestUser();
		expect(await findDataKeyring(u.user.id, masterKey)).toBeUndefined();
		// Sealing off: the name index mints the key in the create's transaction.
		await createCategory(adminDb, u.user.id, { name: "Rent", color: "orange" });
		expect(await findDataKeyring(u.user.id, masterKey)).toBeDefined();
	});

	it("makes no new key after a crypto-shred, and does not fail the caller", async () => {
		setSealingForTests(() => true);
		const u = await createTestUser();
		await ensureUserKeyring(u.user.id);
		await destroyDataKeys(u.user.id);
		await ensureUserKeyringWhenSealing(u.user.id);
		expect(await keyCount(u.user.id)).toBe(0);
	});
});

describe("signed-in requests", () => {
	const router = createTRPCRouter({
		ping: protectedProcedure.query(() => "ok"),
	});
	const ping = (u: TestUser) =>
		createCallerFactory(router)({
			session: makeSession({ id: u.user.id, name: u.user.name }),
			db: u.db,
			headers: new Headers(),
		}).ping();

	it("mint the caller's key only when sealing", async () => {
		const [off, on, v1off, v1on] = [
			await createTestUser(),
			await createTestUser(),
			await createTestUser(),
			await createTestUser(),
		];
		await ping(off);
		expect(
			(await call("/categories", { headers: await asMobile(v1off.user.id) }))
				.status,
		).toBe(200);
		setSealingForTests(() => true);
		await ping(on);
		expect(
			(await call("/categories", { headers: await asMobile(v1on.user.id) }))
				.status,
		).toBe(200);
		expect(
			await Promise.all([off, on, v1off, v1on].map((u) => keyCount(u.user.id))),
		).toEqual([0, 1, 0, 1]);
	});
});
