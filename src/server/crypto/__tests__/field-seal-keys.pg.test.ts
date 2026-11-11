/**
 * Which key the seal path uses and when it is made (E2EE D11 PR 4.2, plan
 * sections 1 and 6), with `sealing()` on: a user's key is made at their first
 * sealing write and never inside a transaction or a preview; a write that
 * cannot have its key fails with the recorded code and stores nothing, while
 * a write with no text still runs; shapes that cannot be sealed are refused.
 */
import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Keyring } from "~/server/crypto/field-crypto";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import { userTransaction, verbatim } from "~/server/db-tx";
import {
	createFiguresRegistry,
	type FigureDb,
} from "~/server/figures/registry";
import {
	isoDay,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import { createCategory } from "~/server/services/category.service";
import { categoryNameIndexFor } from "~/server/services/category-name-index.service";
import { commitImport } from "~/server/services/import/commit.mutation";
import { importRunner } from "~/server/services/import/runner";
import {
	destroyDataKeys,
	ensureUserKeyring,
	evictDataKeyring,
} from "~/server/services/keys/data-key.service";
import { userTransactionRunner } from "~/server/services/preview";
import { createPreviewRunner } from "~/server/services/preview/runner";
import type { MoneyMutation } from "~/server/services/preview/types";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import { ctxFor, SEEDERS } from "~/test/mapped-seeders";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { sealedFile, storedValue, unsealAll } from "~/test/sealed-fixture";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

sealedFile(master);
beforeAll(() => setSealingForTests(() => true));
afterAll(async () => {
	setSealingForTests();
	await unsealAll();
});
beforeEach(() => resetReloadsForTests());

const userKeys = async (userId: string) => {
	const [row] = await adminDb.$queryRaw<{ n: bigint }[]>`
		SELECT count(*) AS "n" FROM keystore."user_data_key" WHERE "userId" = ${userId}`;
	return row?.n;
};
const sealed = (value: unknown) =>
	typeof value === "string" && value.startsWith("\u0001k1:");
const expenseData = (userId: string) => ({
	userId,
	title: `Rent ${randomUUID()}`,
	amount: "150000",
	currency: "ARS",
	date: new Date("2026-11-02T12:00:00Z"),
	amountInUSD: "100",
	exchangeRate: "1500",
	pricingSource: "MANUAL" as const,
});
const expenseCount = (userId: string) =>
	adminDb.expense.count({ where: { userId } });

const createCategoryMutation: MoneyMutation<
	{ name: string },
	{ name: string }
> = {
	id: "test.createCategory",
	touches: [],
	run: async (tx, input, actor) => {
		const nameIndex = await categoryNameIndexFor(tx, input.name);
		const row = await tx.category.create({
			data: {
				userId: actor.userId,
				name: input.name,
				color: "blue",
				nameIndex,
			},
		});
		return {
			value: { name: row.name },
			undo: {
				kind: "revert",
				mutation: "test.createCategory",
				rows: [{ table: "category", id: row.id }],
			},
		};
	},
};

describe("making a user's key", () => {
	it("makes one key at a cold user's first sealed writes, shared by two at once", async () => {
		const me = (await createTestUser()).user.id;
		const scoped = createUserScopedDb(me);
		const [a, b] = await Promise.all([
			scoped.expense.create({ data: expenseData(me) }),
			scoped.expense.create({ data: expenseData(me) }),
		]);
		expect(await userKeys(me)).toBe(1n);
		for (const row of [a, b]) {
			expect(sealed(await storedValue("expense", "title", row.id))).toBe(true);
			const read = await scoped.expense.findUnique({ where: { id: row.id } });
			expect(read?.title).toBe(row.title);
		}
	});

	it("gives the D9 index no key inside a transaction; the key comes from a mint outside it", async () => {
		const me = (await createTestUser()).user.id;
		await expect(
			userTransaction(db, me, (tx) => categoryNameIndexFor(tx, "Food")),
		).rejects.toMatchObject({ code: "key_rotated" });
		// The transaction rolled back, so a key that exists now was made outside it.
		await vi.waitFor(async () => expect(await userKeys(me)).toBe(1n));
	});

	it("previews a cold user's category create with no key, then applies it sealed", async () => {
		const me = (await createTestUser()).user.id;
		const runner = createPreviewRunner({
			figures: createFiguresRegistry<FigureDb>([]),
			actor: { userId: me },
			transaction: userTransactionRunner(me),
		});
		const preview = await runner.preview(createCategoryMutation, {
			name: "Groceries",
		});
		expect(preview.value).toEqual({ name: "Groceries" });
		expect(await userKeys(me)).toBe(0n);
		expect(await adminDb.category.count({ where: { userId: me } })).toBe(0);

		// The apply's transaction may not mint: it asks for a retry and mints outside.
		await expect(
			runner.apply(createCategoryMutation, { name: "Groceries" }),
		).rejects.toMatchObject({ code: "key_rotated" });
		await vi.waitFor(async () => expect(await userKeys(me)).toBe(1n));
		const applied = await runner.apply(createCategoryMutation, {
			name: "Groceries",
		});
		expect(applied.value).toEqual(preview.value);
		const row = await adminDb.category.findFirstOrThrow({
			where: { userId: me },
		});
		expect(sealed(await storedValue("category", "name", row.id))).toBe(true);
		expect(row.nameIndex).toMatch(/^[0-9a-f]{16}:[0-9a-f]{64}$/);
	});

	it("makes the key before createCategory's transaction, once", async () => {
		const me = (await createTestUser()).user.id;
		const row = await createCategory(createUserScopedDb(me), me, {
			name: "Fuel",
			color: "blue",
		});
		expect(row.name).toBe("Fuel");
		expect(await userKeys(me)).toBe(1n);
		expect(sealed(await storedValue("category", "name", row.id))).toBe(true);
	});

	it("previews a cold user's import through the import runner with no key", async () => {
		const me = (await createTestUser()).user.id;
		await adminDb.user.update({
			where: { id: me },
			data: { homeCurrency: "ARS" },
		});
		await seedArsRates();
		// The job is a row from before the flip, so making it mints nothing.
		setSealingForTests();
		const job = await adminDb.importJob.create({
			data: {
				userId: me,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "galicia.csv",
				fileSize: 1,
				fileType: "csv",
				transactions: [
					{
						title: "Panaderia",
						amount: 4500,
						currency: "ARS",
						date: isoDay(TODAY),
						location: "",
						description: "",
						pricingSource: "IMPORT",
						category: "",
					},
				],
			},
		});
		setSealingForTests(() => true);
		const preview = await importRunner(me).preview(commitImport, {
			jobId: job.id,
			rows: [{ index: 0, keep: true, categoryId: null, kind: "expense" }],
		});
		expect(preview.value.created).toBe(1);
		expect(await expenseCount(me)).toBe(0);
		expect(await userKeys(me)).toBe(0n);
	});

	it("ends with no key when a background mint races the account's deletion", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { user } = await createTestUser();
		// The write's transaction may not mint: it starts one in the background.
		const write = userTransaction(db, user.id, (tx) =>
			tx.expense.create({ data: expenseData(user.id), select: { id: true } }),
		);
		const deletion = anonymizeAndDeleteUser(adminDb, user.id, user.email, null);
		await expect(write).rejects.toMatchObject({ code: "key_rotated" });
		await deletion;
		// Wait for the background mint (or fail to start one): nothing escapes.
		await ensureUserKeyring(user.id).catch(() => undefined);
		expect(await userKeys(user.id)).toBe(0n);
		expect(await adminDb.user.count({ where: { id: user.id } })).toBe(0);
		vi.restoreAllMocks();
	});
});

describe("failing closed", () => {
	it("refuses text with no master key, and still runs a write with no text", async () => {
		const me = (await createTestUser()).user.id;
		const scoped = createUserScopedDb(me);
		const category = await scoped.category.create({
			data: {
				userId: me,
				name: "Food",
				color: "blue",
				nameIndex: `t:${randomUUID()}`,
			},
		});
		const kept = master.ring;
		master.ring = undefined;
		try {
			await expect(
				scoped.expense.create({ data: expenseData(me) }),
			).rejects.toMatchObject({ code: "master_key_missing" });
			await expect(
				db.project.create({ data: { name: "Trip", createdById: me } }),
			).rejects.toMatchObject({ code: "master_key_missing" });
			// The row it returns would hold a name it cannot open, so it reads none.
			await scoped.category.update({
				where: { id: category.id },
				data: { color: "red" },
				select: { id: true },
			});
		} finally {
			master.ring = kept;
		}
		expect(await expenseCount(me)).toBe(0);
		expect(await adminDb.project.count({ where: { createdById: me } })).toBe(0);
	});

	it("refuses text once a user's key is lost, in and out of a transaction", async () => {
		const me = (await createTestUser()).user.id;
		const scoped = createUserScopedDb(me);
		await scoped.expense.create({ data: expenseData(me) });
		// A restore without the keystore: the key row is gone, the marker stays.
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${me}`;
		evictDataKeyring(me);
		await expect(
			createUserScopedDb(me).expense.create({ data: expenseData(me) }),
		).rejects.toMatchObject({ code: "keystore_lost" });
		await expect(
			userTransaction(db, me, (tx) =>
				tx.expense.create({ data: expenseData(me) }),
			),
		).rejects.toMatchObject({ code: "keystore_lost" });
		expect(await expenseCount(me)).toBe(1);
		expect(await userKeys(me)).toBe(0n);
	});

	it("refuses text after a crypto-shred and mints no stranger key", async () => {
		const me = (await createTestUser()).user.id;
		await createUserScopedDb(me).expense.create({ data: expenseData(me) });
		await destroyDataKeys(me);
		await expect(
			createUserScopedDb(me).expense.create({ data: expenseData(me) }),
		).rejects.toMatchObject({ code: "keystore_lost" });
		expect(await userKeys(me)).toBe(0n);
		expect(await expenseCount(me)).toBe(1);
	});
});

describe("shapes that cannot be sealed", () => {
	it("refuses user text on the global client or for another owner, and a bulk text write", async () => {
		const me = (await createTestUser()).user.id;
		const other = (await createTestUser()).user.id;
		await expect(
			db.expense.create({ data: expenseData(me) }),
		).rejects.toMatchObject({ code: "foreign_owner" });
		await expect(
			createUserScopedDb(me).expense.create({ data: expenseData(other) }),
		).rejects.toMatchObject({ code: "foreign_owner" });
		const shared = await db.sharedTransaction.create({
			data: (await SEEDERS.SharedTransaction(ctxFor(me))) as never,
		});
		await expect(
			db.splitParticipant.updateMany({
				where: { transactionId: shared.id },
				data: { rejectionReason: "no" },
			}),
		).rejects.toMatchObject({ code: "bulk_text_write" });
		// A null seals nothing (transaction.service.ts clears reasons this way).
		await db.splitParticipant.updateMany({
			where: { transactionId: shared.id },
			data: { rejectionReason: null },
		});
	});

	it("stores verbatim values as given: plaintext, or this very cell's ciphertext, never another's", async () => {
		const me = (await createTestUser()).user.id;
		const make = async () =>
			db.sharedTransaction.create({
				data: (await SEEDERS.SharedTransaction(ctxFor(me))) as never,
			});
		const [a, b] = [await make(), await make()];
		const cell = (id: string) => storedValue("shared_transaction", "notes", id);
		// The query runs when awaited, so it is awaited inside the scope.
		const putBack = (notes: unknown) =>
			verbatim(async () => {
				await db.sharedTransaction.update({
					where: { id: a.id },
					data: { notes: notes as string },
					select: { id: true },
				});
			});
		const own = await cell(a.id);
		await putBack(own);
		expect(await cell(a.id)).toBe(own);
		await expect(putBack(await cell(b.id))).rejects.toMatchObject({
			code: "auth_failed",
		});
		await putBack("as typed");
		expect(await cell(a.id)).toBe("as typed");
	});
});
