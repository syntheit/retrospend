/**
 * Who opens a sealed cell, on every client and path (E2EE D11 PR 3.2, plan
 * tests 8 and 9 and section 2.3). Ana and Beto share a project and a budget
 * book; both have ARS as their home currency. Hand-derived expectations:
 *
 *   Ana's own sealed category, on her scoped client, in userTransaction, in a preview -> plaintext
 *   Ana's category read by Beto, a guest, a viewer link or the public -> "" (not tried), page still loads
 *   the shared expense and project name (instance key), any of them -> plaintext
 *   Beto's split category read by Ana (the payer)                  -> ""
 *   a co-member's template, account or expense through a book relation -> never their text
 *   income rule and wealth transfer text, read by the other member -> plaintext (instance key)
 *   a cell copied from another of Ana's rows                        -> auth_failed
 *   a user-class cell sealed with the instance key                  -> auth_failed
 *   Ana's key row deleted, or the instance key deleted              -> keystore_lost, no fallback
 *   a key id the ring lacks                                         -> one reload, then keystore_lost (own) or "" (foreign, no load)
 *   no master key                                                   -> plaintext requests touch no keystore; a sealed cell fails master_key_missing
 *   keystore grants lost                                            -> plaintext reads and writes work; a sealed cell fails keystore_grants_missing
 *   20 cold global reads of one sealed instance cell                -> all open, one keystore load
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { type FieldCryptoError, Keyring } from "~/server/crypto/field-crypto";
import {
	fieldOpenSlot,
	TextUnavailableError,
	unavailableFields,
} from "~/server/crypto/field-open";
import { buildModelGraph } from "~/server/crypto/model-graph";
import { resetReloadsForTests, textKeys } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import { buildClients, keystoreDb, runtimeDataModel } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import { exportProjectExpenses } from "~/server/services/export/project-csv";
import { evictDataKeyring } from "~/server/services/keys/data-key.service";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
} from "~/server/services/keys/instance-key.service";
import { forUser } from "~/server/services/preview";
import {
	readProjectPage,
	readSharedProjectPage,
} from "~/server/services/project/page-view";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	instanceKeyring,
	newMasterKeyring,
	restoreCells,
	sealCell,
	sealRow,
	storedValue,
	writeCell,
} from "~/test/sealed-fixture";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

const MASTER = newMasterKeyring();

async function resetInstanceKey() {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
}
beforeAll(async () => {
	await resetInstanceKey();
	master.ring = MASTER;
});
afterAll(async () => {
	await restoreCells();
	await resetInstanceKey();
});
beforeEach(() => {
	master.ring = MASTER;
	resetReloadsForTests();
});
afterEach(() => vi.restoreAllMocks());

const day = new Date("2026-11-02T12:00:00Z");

/** The world both tests read: two people, a project, a book, sealed text. */
async function world() {
	const [ana, beto] = await Promise.all([createTestUser(), createTestUser()]);
	const a = ana.user.id;
	const b = beto.user.id;
	await adminDb.user.updateMany({
		where: { id: { in: [a, b] } },
		data: { homeCurrency: "ARS" },
	});
	const anaCategory = await adminDb.category.create({
		data: { userId: a, name: "Comida", color: "blue" },
	});
	const betoCategory = await adminDb.category.create({
		data: { userId: b, name: "Salidas", color: "teal" },
	});
	const project = await adminDb.project.create({
		data: { name: "Bariloche", description: "Ski trip", createdById: a },
	});
	await adminDb.projectParticipant.createMany({
		data: [a, b].map((id) => ({
			projectId: project.id,
			participantType: "user" as const,
			participantId: id,
		})),
	});
	const shared = await adminDb.sharedTransaction.create({
		data: {
			description: "Cena",
			notes: "Con vino",
			amount: "30000",
			currency: "ARS",
			date: day,
			paidByType: "user",
			paidById: a,
			createdByType: "user",
			createdById: a,
			projectId: project.id,
			categoryId: anaCategory.id,
			splitParticipants: {
				create: [
					{ participantType: "user", participantId: a, shareAmount: "15000" },
					{
						participantType: "user",
						participantId: b,
						shareAmount: "15000",
						categoryId: betoCategory.id,
					},
				],
			},
		},
	});
	const expense = await adminDb.expense.create({
		data: {
			userId: a,
			title: "Alquiler",
			amount: "150000",
			currency: "ARS",
			date: day,
			amountInUSD: "100",
			exchangeRate: "1500",
			pricingSource: "MANUAL",
			categoryId: anaCategory.id,
		},
	});
	for (const [table, id] of [
		["category", anaCategory.id],
		["category", betoCategory.id],
		["project", project.id],
		["shared_transaction", shared.id],
		["expense", expense.id],
		["user", a],
		["user", b],
	] as const)
		await sealRow(MASTER, table, id);
	return { a, b, anaCategory, betoCategory, project, shared, expense };
}

type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeAll(async () => {
	w = await world();
});

const json = (value: unknown) => JSON.stringify(value);

describe("the reader's own text, on every path", () => {
	it("opens on the scoped client, in userTransaction and in a preview", async () => {
		const scoped = await createUserScopedDb(w.a).expense.findUnique({
			where: { id: w.expense.id },
			include: { category: true },
		});
		expect([scoped?.title, scoped?.category?.name]).toEqual([
			"Alquiler",
			"Comida",
		]);
		const inTx = await userTransaction(db, w.a, (tx) =>
			tx.expense.findUnique({
				where: { id: w.expense.id },
				select: { title: true, category: { select: { name: true } } },
			}),
		);
		expect(inTx).toEqual({ title: "Alquiler", category: { name: "Comida" } });
		const previewed = await forUser(w.a).preview(
			{
				id: "test.readTitle",
				touches: [],
				run: async (tx) => {
					const row = await tx.expense.findUniqueOrThrow({
						where: { id: w.expense.id },
						select: { title: true },
					});
					return {
						value: row.title,
						undo: { kind: "revert", mutation: "test.readTitle", rows: [] },
					};
				},
			},
			{},
		);
		expect(previewed.value).toBe("Alquiler");
	});

	it("opens instance text and user names for better-auth, and hides user-class text on the global client", async () => {
		const adapter = prismaAdapter(db, { provider: "postgresql" })(
			{} as BetterAuthOptions,
		);
		const user = await adapter.findOne<{ name: string }>({
			model: "user",
			where: [{ field: "id", value: w.a }],
		});
		expect(user?.name).toBe(
			(await adminDb.user.findUnique({ where: { id: w.a } }))?.name,
		);
		expect(user?.name.startsWith("Test ")).toBe(true);
		const project = await db.project.findUnique({
			where: { id: w.project.id },
		});
		expect([project?.name, project?.description]).toEqual([
			"Bariloche",
			"Ski trip",
		]);
		// The global client has no user, so every user-class cell is someone else's.
		const category = await db.category.findUniqueOrThrow({
			where: { id: w.anaCategory.id },
		});
		expect(category.name).toBe("");
		expect(unavailableFields(category)).toEqual(["name"]);
	});

	it("exports the exporter's own category and hides the co-participant's", async () => {
		const ctx = (userId: string) => ({
			db: createUserScopedDb(userId),
			userId,
			timeZone: "America/Argentina/Buenos_Aires",
		});
		const mine = await exportProjectExpenses(ctx(w.a), {
			projectId: w.project.id,
		});
		expect(mine.csv).toContain("Cena");
		expect(mine.csv).toContain("Comida");
		expect(mine.filename).toContain("bariloche");
		const theirs = await exportProjectExpenses(ctx(w.b), {
			projectId: w.project.id,
		});
		expect(theirs.csv).toContain("Cena");
		expect(theirs.csv).not.toContain("Comida");
		expect(theirs.csv).not.toContain("\u0001");
	});
});

describe("another owner's text (section 2.3)", () => {
	it("1: a co-participant reads the project page with the payer's category hidden", async () => {
		const warn = vi.spyOn(console, "warn");
		const page = await readProjectPage(
			createUserScopedDb(w.b),
			w.project.id,
			w.b,
		);
		expect(json(page)).toContain("Cena");
		expect(json(page)).toContain("Bariloche");
		expect(json(page)).not.toContain("Comida");
		expect(json(page)).not.toContain("\\u0001");
		expect(warn).toHaveBeenCalledWith("encrypted_text_unavailable", {
			table: "category",
			column: "name",
		});
		const own = await readProjectPage(
			createUserScopedDb(w.a),
			w.project.id,
			w.a,
		);
		expect(json(own)).toContain("Comida");
	});

	it("2: a guest, a viewer link and the public read the page with categories hidden", async () => {
		const link = await adminDb.magicLink.create({
			data: { projectId: w.project.id, createdById: w.a },
		});
		const guest = await adminDb.guestSession.create({
			data: {
				name: "Invitada",
				email: `${randomUUID()}@pg-test.invalid`,
				magicLinkId: link.id,
				projectId: w.project.id,
				sessionToken: randomUUID(),
			},
		});
		for (const viewer of [
			{ kind: "guest", guestId: guest.id },
			{ kind: "link" },
			{ kind: "public" },
		] as const) {
			const page = await readSharedProjectPage(db, w.project.id, viewer);
			expect(json(page), viewer.kind).toContain("Bariloche");
			expect(json(page), viewer.kind).toContain("Cena");
			expect(json(page), viewer.kind).not.toContain("Comida");
			expect(json(page), viewer.kind).not.toContain("\\u0001");
		}
	});

	it("3: an export by a co-participant (above) hides the payer's category", async () => {
		const sheet = await exportProjectExpenses(
			{ db: createUserScopedDb(w.b), userId: w.b, timeZone: "UTC" },
			{ projectId: w.project.id },
		);
		expect(sheet.csv).not.toContain("Comida");
	});

	it("4: a book member never reads a co-member's template, account or expense", async () => {
		const book = await adminDb.budgetBook.create({
			data: {
				currency: "ARS",
				startDate: day,
				startMonth: 202611,
				createdById: w.a,
				isPersonal: false,
				members: {
					create: [
						{ userId: w.a, role: "OWNER" },
						{ userId: w.b, role: "EDITOR" },
					],
				},
			},
		});
		const template = await adminDb.recurringTemplate.create({
			data: {
				userId: w.a,
				name: "Gimnasio",
				amount: "20000",
				currency: "ARS",
				frequency: "MONTHLY",
				nextDueDate: day,
			},
		});
		const account = await adminDb.assetAccount.create({
			data: {
				userId: w.a,
				name: "Ahorro",
				type: "CASH",
				currency: "ARS",
				balance: "0",
			},
		});
		const envelope = await adminDb.envelope.create({
			data: {
				bookId: book.id,
				name: "Gym",
				sortOrder: 0,
				targetTemplateId: template.id,
				wealthAccountId: account.id,
			},
		});
		const movement = await adminDb.budgetMovement.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				month: 202611,
				amount: "5000",
				kind: "ASSIGN",
				actorUserId: w.a,
				toEnvelopeId: envelope.id,
				sourceExpenseId: w.expense.id,
			},
		});
		await sealRow(MASTER, "recurring_template", template.id);
		await sealRow(MASTER, "asset_account", account.id);
		const include = { targetTemplate: true, wealthAccount: true } as const;
		const names = async (client: typeof db) => {
			const env = await client.envelope.findUniqueOrThrow({
				where: { id: envelope.id },
				include,
			});
			const moved = await client.budgetMovement.findUniqueOrThrow({
				where: { id: movement.id },
				include: { sourceExpense: true },
			});
			return [
				env.targetTemplate?.name ?? null,
				env.wealthAccount?.name ?? null,
				moved.sourceExpense?.title ?? null,
			];
		};
		// RLS hides them from Beto; the global client, with no user, gets the fallback.
		expect(await names(createUserScopedDb(w.b))).toEqual([null, null, null]);
		expect(await names(db)).toEqual(["", "", ""]);
		const owner = await createUserScopedDb(w.a).envelope.findUniqueOrThrow({
			where: { id: envelope.id },
			include,
		});
		expect([owner.targetTemplate?.name, owner.wealthAccount?.name]).toEqual([
			"Gimnasio",
			"Ahorro",
		]);
	});

	it("4b: income rule and wealth transfer text is the book's, so the other member reads it", async () => {
		const book = await adminDb.budgetBook.create({
			data: {
				currency: "ARS",
				startDate: day,
				startMonth: 202611,
				createdById: w.a,
				isPersonal: false,
				members: { create: [{ userId: w.a }, { userId: w.b, role: "EDITOR" }] },
			},
		});
		const envelope = await adminDb.envelope.create({
			data: { bookId: book.id, name: "Sueldo", sortOrder: 0 },
		});
		const rule = await adminDb.incomeRule.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				sortOrder: 0,
				name: "Salario",
				matchTitle: "ACME SA",
				action: "PERCENT",
				envelopeId: envelope.id,
			},
		});
		const moved = await adminDb.wealthTransfer.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				direction: "TO_WEALTH",
				date: day,
				amount: "5000",
				actorUserId: w.a,
				note: "Al fondo",
			},
		});
		await sealRow(MASTER, "income_rule", rule.id);
		await sealRow(MASTER, "wealth_transfer", moved.id);
		const beto = createUserScopedDb(w.b);
		expect(
			await beto.incomeRule.findUnique({
				where: { id: rule.id },
				select: { name: true, matchTitle: true },
			}),
		).toEqual({ name: "Salario", matchTitle: "ACME SA" });
		expect(
			(await beto.wealthTransfer.findUnique({ where: { id: moved.id } }))?.note,
		).toBe("Al fondo");
	});

	it("5: the payer never reads a split's category", async () => {
		const read = {
			include: { splitParticipants: { include: { category: true } } },
		};
		const scoped = await createUserScopedDb(
			w.a,
		).sharedTransaction.findUniqueOrThrow({
			where: { id: w.shared.id },
			...read,
		});
		expect(scoped.description).toBe("Cena");
		const split = (t: typeof scoped) =>
			t.splitParticipants.find((s) => s.participantId === w.b);
		// RLS hides Beto's category from Ana; the global client gets the fallback.
		expect(split(scoped)?.category).toBeNull();
		const global = await db.sharedTransaction.findUniqueOrThrow({
			where: { id: w.shared.id },
			...read,
		});
		expect(split(global)?.category?.name).toBe("");
		expect(unavailableFields(split(global)?.category as object)).toEqual([
			"name",
		]);
	});

	it("6: the push worker's device read leaves the device name out", async () => {
		const device = await adminDb.pushDevice.create({
			data: {
				userId: w.a,
				platform: "IOS",
				transport: "APNS",
				token: randomUUID(),
				addressHash: randomUUID(),
				deviceName: "iPhone de Ana",
			},
		});
		await sealRow(MASTER, "push_device", device.id);
		const warn = vi.spyOn(console, "warn");
		// The worker's own query shape (push/worker.ts).
		const read = await db.pushDevice.findUnique({
			where: { id: device.id },
			omit: { deviceName: true },
			include: { user: { select: { language: true, isActive: true } } },
		});
		expect(read && "deviceName" in read).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});

	it("7: the push and export sweeps select no text", async () => {
		const warn = vi.spyOn(console, "warn");
		await db.recurringTemplate.findMany({
			where: { userId: w.a },
			select: { id: true, userId: true },
		});
		await db.exportJob.findMany({ select: { id: true, expiresAt: true } });
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("integrity and lost keys", () => {
	it("fails a sealed cell copied between two of the reader's rows", async () => {
		const other = await adminDb.expense.create({
			data: {
				userId: w.a,
				title: "Otra",
				amount: "1000",
				currency: "ARS",
				date: day,
				amountInUSD: "0.67",
				exchangeRate: "1500",
				pricingSource: "MANUAL",
			},
		});
		const sealed = await storedValue("expense", "title", w.expense.id);
		await writeCell("expense", "title", other.id, sealed as string);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = await createUserScopedDb(w.a)
			.expense.findUnique({ where: { id: other.id } })
			.catch((e: unknown) => e);
		expect((failure as FieldCryptoError).code).toBe("auth_failed");
		expect(error).toHaveBeenCalledWith("Sealed text could not be opened", {
			table: "expense",
			column: "title",
			code: "auth_failed",
		});
	});

	it("fails a user-class cell sealed with the instance key", async () => {
		const row = await adminDb.category.create({
			data: { userId: w.a, name: "Instance sealed", color: "sky" },
		});
		await sealCell(
			await instanceKeyring(MASTER),
			{
				table: "category",
				column: "name",
				rowId: row.id,
			},
			"Mal sellada",
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = await createUserScopedDb(w.a)
			.category.findUnique({ where: { id: row.id } })
			.catch((e: unknown) => e);
		expect((failure as FieldCryptoError).code).toBe("auth_failed");
	});

	it("fails an own cell with keystore_lost when the key row is gone, not the fallback", async () => {
		const { user } = await createTestUser();
		const row = await adminDb.category.create({
			data: { userId: user.id, name: "Perdida", color: "sky" },
		});
		await sealRow(MASTER, "category", row.id);
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${user.id}`;
		evictDataKeyring(user.id);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = await createUserScopedDb(user.id)
			.category.findUnique({ where: { id: row.id } })
			.catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(TextUnavailableError);
		expect((failure as TextUnavailableError).code).toBe("keystore_lost");
	});

	it("reloads once on a key id the ring lacks, then fails an own cell and hides a foreign one", async () => {
		const stranger = new Keyring([{ id: 7, key: randomBytes(32) }]);
		const row = await adminDb.category.create({
			data: { userId: w.a, name: "Key seven", color: "sky" },
		});
		const cell = { table: "category", column: "name", rowId: row.id };
		await sealCell(stranger, cell, "Clave 7");
		await createUserScopedDb(w.a).$transaction(async () => {}); // warm the caches
		const loads = vi.spyOn(keystoreDb, "$transaction");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const read = () =>
			createUserScopedDb(w.a)
				.category.findUnique({ where: { id: row.id } })
				.catch((e: unknown) => e);
		expect(((await read()) as TextUnavailableError).code).toBe("keystore_lost");
		// ready() is served from the cache; the reload is the one load.
		expect(loads).toHaveBeenCalledTimes(1);
		// Within 5 seconds the next reload of Ana's ring is not repeated.
		expect(await read()).toBeInstanceOf(TextUnavailableError);
		expect(loads).toHaveBeenCalledTimes(1);
		const hidden = await db.category.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(hidden.name).toBe("");
		expect(loads).toHaveBeenCalledTimes(1);
	});

	it("fails an instance cell with keystore_lost when the instance key is gone", async () => {
		const project = await adminDb.project.create({
			data: { name: "Sin clave", createdById: w.a },
		});
		await sealRow(MASTER, "project", project.id);
		const before = await adminDb.$queryRaw<
			{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
		>`
			SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const failure = await createUserScopedDb(w.a)
				.project.findUnique({ where: { id: project.id } })
				.catch((e: unknown) => e);
			expect((failure as TextUnavailableError).code).toBe("keystore_lost");
		} finally {
			for (const k of before)
				await adminDb.$executeRaw`
					INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
					VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
			evictInstanceKeyring();
		}
	});
});

describe("a plaintext ledger", () => {
	it("with no master key, runs reads and writes with no keystore query; a sealed cell fails master_key_missing", async () => {
		const { user } = await createTestUser();
		master.ring = undefined;
		const calls = [
			vi.spyOn(keystoreDb, "$transaction"),
			vi.spyOn(keystoreDb, "$queryRaw"),
			vi.spyOn(keystoreDb, "$executeRaw"),
		];
		const scoped = createUserScopedDb(user.id);
		const made = await scoped.expense.create({
			data: {
				userId: user.id,
				title: "Café",
				amount: "3500",
				currency: "ARS",
				date: day,
				amountInUSD: "2.33",
				exchangeRate: "1500",
				pricingSource: "MANUAL",
			},
		});
		await userTransaction(scoped, user.id, (tx) =>
			tx.expense.update({
				where: { id: made.id },
				data: { title: "Café doble" },
			}),
		);
		expect(
			(await scoped.expense.findMany({ where: { userId: user.id } })).map(
				(e) => e.title,
			),
		).toEqual(["Café doble"]);
		const own = await db.project.create({
			data: { name: "Plano", createdById: user.id },
		});
		expect(
			await db.$transaction((tx) =>
				tx.project.findMany({ where: { createdById: user.id } }),
			),
		).toMatchObject([{ id: own.id, name: "Plano" }]);
		for (const spy of calls) expect(spy).not.toHaveBeenCalled();

		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = await createUserScopedDb(w.a)
			.project.findUnique({ where: { id: w.project.id } })
			.catch((e: unknown) => e);
		expect((failure as TextUnavailableError).code).toBe("master_key_missing");
	});

	it("with keystore grants lost, plaintext reads and writes work; a sealed cell fails keystore_grants_missing", async () => {
		const { user } = await createTestUser();
		const row = await adminDb.category.create({
			data: { userId: user.id, name: "Sellada", color: "sky" },
		});
		await sealRow(MASTER, "category", row.id);
		evictDataKeyring(user.id);
		await adminDb.$executeRawUnsafe(
			'REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM retrospend_app',
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const scoped = createUserScopedDb(user.id);
			const plain = await scoped.category.create({
				data: { userId: user.id, name: "Plana", color: "blue" },
			});
			await userTransaction(scoped, user.id, (tx) =>
				tx.category.update({
					where: { id: plain.id },
					data: { color: "teal" },
				}),
			);
			expect(
				(await scoped.category.findUnique({ where: { id: plain.id } }))?.name,
			).toBe("Plana");
			const failure = await scoped.category
				.findUnique({ where: { id: row.id } })
				.catch((e: unknown) => e);
			expect((failure as TextUnavailableError).code).toBe(
				"keystore_grants_missing",
			);
		} finally {
			await adminDb.$executeRawUnsafe(
				'GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app',
			);
		}
	});
});

describe("cold reads on the global client", () => {
	it("opens 20 concurrent cold reads of one sealed instance cell with one keystore load", async () => {
		const ring = await instanceKeyring(MASTER);
		const project = await adminDb.project.create({
			data: { name: "x", createdById: w.a },
		});
		await sealCell(
			ring,
			{ table: "project", column: "name", rowId: project.id },
			"Frío",
		);
		// Fresh clients, as at boot: the global client's keys have recorded nothing.
		const instance = () => findInstanceKeyring();
		const fresh = buildClients(
			{
				instance: textKeys({ instance }),
				user: (userId) => textKeys({ instance }, userId),
			},
			undefined,
			fieldOpenSlot(() => buildModelGraph(runtimeDataModel())),
		);
		evictInstanceKeyring();
		const loads = vi.spyOn(keystoreDb, "$transaction");
		const reads = await Promise.all(
			Array.from({ length: 20 }, () =>
				fresh.db.project.findUnique({ where: { id: project.id } }),
			),
		);
		expect(reads.map((r) => r?.name)).toEqual(Array(20).fill("Frío"));
		expect(loads).toHaveBeenCalledTimes(1);
	});
});
