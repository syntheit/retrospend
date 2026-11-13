/**
 * Error report text at rest (E2EE D11 Revision 3, PR 1): `error_report.message`
 * and `stack` are instance-class cells. With sealing on, a report the app
 * sends is stored as `\u0001k1:` ciphertext in both columns, under the AAD of
 * its own row, and the admin reads it as plaintext through the v1 list and the
 * web procedure. Expected values are the plaintexts the scrubber leaves,
 * derived by hand from scrubErrorText and scrubStack:
 *
 *   message "Boom en el resumen de ARS 18000"  -> "Boom en el resumen de ARS #"
 *   stack "at go (https://me.example/bundle.js:12:3)\nat run (app.js:7:1)"
 *                                                -> "at bundle.js:12:3\nat app.js:7:1"
 *   message "bo<BEL>om"                          -> stored "boom" (control stripped)
 *   batch ["<U+0001>boom", "Sigue"]               -> 201, stored 1 (only "Sigue")
 *
 * Retention, with a fixed `now` and the 30 day limit: a report made 29 days
 * before is kept, one made 31 days before is deleted, sealed or not, and the
 * sweep runs with the instance key gone. A client built after the key is
 * lost fails its read with keystore_lost.
 */
import { contract } from "@retrospend/api-contract";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { createCallerFactory } from "~/server/api/trpc";
import { type Keyring, openField } from "~/server/crypto/field-crypto";
import { TextUnavailableError } from "~/server/crypto/field-open";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import {
	ERROR_REPORT_RETENTION_DAYS,
	sweepErrorReports,
} from "~/server/services/api-v1/retention-sweep";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import {
	instanceKeyring,
	sealedFile,
	storedValue,
	unsealAll,
} from "~/test/sealed-fixture";
import { makeSession } from "~/test/trpc-test-utils";
import {
	adminDb,
	asKey,
	call,
	createTestUser,
	expectBody,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

sealedFile(master);
beforeAll(() => setSealingForTests(() => true));
afterEach(() => setSealingForTests(() => true));
afterAll(async () => {
	setSealingForTests();
	await adminDb.errorReport.deleteMany({
		where: { userId: { in: [...users] } },
	});
	// The users this file made have sealed names (sealing was on when they
	// were created); the keys go with the file.
	await unsealAll();
});

const a = contract.admin;
const SEALED = "\u0001k1:";
const users = new Set<string>();

const MESSAGE = "Boom en el resumen de ARS 18000";
const MESSAGE_STORED = "Boom en el resumen de ARS #";
const STACK = "at go (https://me.example/bundle.js:12:3)\nat run (app.js:7:1)";
const STACK_STORED = "at bundle.js:12:3\nat app.js:7:1";

const report = (over: Record<string, unknown> = {}) => ({
	kind: "crash",
	message: MESSAGE,
	stack: STACK,
	occurredAt: "2026-11-02T12:00:00.000Z",
	...over,
});

async function person(role?: "ADMIN") {
	const made = await createTestUser(role ? { role } : {});
	users.add(made.user.id);
	return made;
}

const send = (userId: string, reports: unknown[]) =>
	asKey(userId, ["read", "write:settings"]).then((headers) =>
		call("/error-reports", {
			method: "POST",
			headers,
			body: { reports },
			idempotent: true,
		}),
	);

type Item = { id: string; message: string; stack: string | null };

async function adminList(admin: string) {
	return expectBody<{ items: Item[] }>(
		await call("/admin/error-reports?limit=100", {
			headers: await asKey(admin, ["admin"]),
		}),
		a.listErrorReports,
	);
}

const rowsOf = (userId: string) =>
	adminDb.$queryRaw<{ id: string; message: string; stack: string | null }[]>`
		SELECT "id", "message", "stack" FROM "error_report"
		WHERE "userId" = ${userId} ORDER BY "createdAt", "id"`;

describe("an error report sent with sealing on", () => {
	it("is sealed in both columns on the instance key, and the admin reads the plaintext", async () => {
		const admin = (await person("ADMIN")).user.id;
		const bob = (await person()).user.id;
		expect((await send(bob, [report()])).status).toBe(201);

		const [row] = await rowsOf(bob);
		expect(row?.message.startsWith(SEALED)).toBe(true);
		expect(row?.stack?.startsWith(SEALED)).toBe(true);
		expect(row?.message).not.toContain("Boom");
		expect(row?.stack).not.toContain("bundle");

		const ring = await instanceKeyring(master.ring as Keyring);
		const id = row?.id ?? "";
		expect(
			openField(ring, row?.message ?? "", {
				table: "error_report",
				column: "message",
				rowId: id,
			}),
		).toBe(MESSAGE_STORED);
		expect(
			openField(ring, row?.stack ?? "", {
				table: "error_report",
				column: "stack",
				rowId: id,
			}),
		).toBe(STACK_STORED);

		const page = await adminList(admin);
		expect(page.items.find((i) => i.id === id)).toMatchObject({
			message: MESSAGE_STORED,
			stack: STACK_STORED,
		});

		const web = createCallerFactory(feedbackRouter)({
			session: makeSession({ id: admin, name: "Admin", role: "ADMIN" }),
			db,
			headers: new Headers(),
		});
		const listed = (await web.errorReports({ limit: 100 })).items.find(
			(i) => i.id === id,
		);
		expect(listed).toMatchObject({
			message: MESSAGE_STORED,
			stack: STACK_STORED,
		});
	});

	it("gives a report without a stack a null stack", async () => {
		const bob = (await person()).user.id;
		await send(bob, [report({ stack: undefined })]);
		const [row] = await rowsOf(bob);
		expect(row?.message.startsWith(SEALED)).toBe(true);
		expect(row?.stack).toBeNull();
	});

	it("strips a control character and skips only a report whose text starts with U+0001", async () => {
		const bob = (await person()).user.id;
		await send(bob, [report({ message: "bo\u0007om", stack: undefined })]);
		const [row] = await rowsOf(bob);
		const ring = await instanceKeyring(master.ring as Keyring);
		expect(
			openField(ring, row?.message ?? "", {
				table: "error_report",
				column: "message",
				rowId: row?.id ?? "",
			}),
		).toBe("boom");

		// One bad report in a batch does not stop the good one: the app resends
		// its newest reports, so a refused batch would silence the device.
		const eve = (await person()).user.id;
		const mixed = await send(eve, [
			report({ message: "\u0001boom" }),
			report({ message: "Sigue" }),
		]);
		expect(mixed.status).toBe(201);
		expect(await mixed.json()).toMatchObject({ stored: 1 });
		const kept = await rowsOf(eve);
		expect(kept).toHaveLength(1);
		expect(
			openField(ring, kept[0]?.message ?? "", {
				table: "error_report",
				column: "message",
				rowId: kept[0]?.id ?? "",
			}),
		).toBe("Sigue");

		const only = (await person()).user.id;
		const none = await send(only, [report({ message: "\u0001boom" })]);
		expect(none.status).toBe(201);
		expect(await none.json()).toMatchObject({ stored: 0 });
		expect(await rowsOf(only)).toEqual([]);
	});

	it("fails a read after two reports' message cells are swapped", async () => {
		const bob = (await person()).user.id;
		await send(bob, [report({ message: "Uno" }), report({ message: "Dos" })]);
		const [x, y] = await rowsOf(bob);
		await adminDb.$executeRaw`UPDATE "error_report" SET "message" = ${y?.message ?? ""} WHERE "id" = ${x?.id ?? ""}`;
		await adminDb.$executeRaw`UPDATE "error_report" SET "message" = ${x?.message ?? ""} WHERE "id" = ${y?.id ?? ""}`;
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = await db.errorReport
			.findUnique({ where: { id: x?.id ?? "" } })
			.catch((e: unknown) => e);
		expect(failure).toMatchObject({ code: "auth_failed" });
		vi.restoreAllMocks();
		// The swapped rows would fail every later list of this database.
		await adminDb.errorReport.deleteMany({ where: { userId: bob } });
	});

	it("reads a plaintext row from before sealing, as it is", async () => {
		const admin = (await person("ADMIN")).user.id;
		const bob = (await person()).user.id;
		const id = "clegacyreport0000000001";
		await adminDb.$executeRaw`
			INSERT INTO "error_report" ("id", "userId", "kind", "message", "stack", "occurredAt")
			VALUES (${id}, ${bob}, 'crash', 'Texto viejo ARS #', 'at old.js:1:1', now())`;
		expect(await storedValue("error_report", "message", id)).toBe(
			"Texto viejo ARS #",
		);
		const page = await adminList(admin);
		expect(page.items.find((i) => i.id === id)).toMatchObject({
			message: "Texto viejo ARS #",
			stack: "at old.js:1:1",
		});
	});

	it("is stored as plaintext, and read the same, with sealing off", async () => {
		setSealingForTests(() => false);
		const admin = (await person("ADMIN")).user.id;
		const bob = (await person()).user.id;
		await send(bob, [report()]);
		const [row] = await rowsOf(bob);
		expect(row).toMatchObject({
			message: MESSAGE_STORED,
			stack: STACK_STORED,
		});
		const page = await adminList(admin);
		expect(page.items.find((i) => i.id === row?.id)?.message).toBe(
			MESSAGE_STORED,
		);
	});
});

describe("retention of sealed reports", () => {
	const day = 24 * 60 * 60 * 1000;
	const now = new Date("2026-11-12T12:00:00Z");
	const ago = (days: number) => new Date(now.getTime() - days * day);

	it("keeps a 29 day old report and deletes a 31 day old one, with the instance key gone", async () => {
		expect(ERROR_REPORT_RETENTION_DAYS).toBe(30);
		const bob = (await person()).user.id;
		const make = (days: number) =>
			db.errorReport.create({
				data: {
					userId: bob,
					kind: "crash",
					message: `m ${days}`,
					stack: `at s.js:${days}:1`,
					occurredAt: ago(days),
					createdAt: ago(days),
				},
				select: { id: true },
			});
		const fresh = await make(29);
		const old = await make(31);
		expect(
			(
				(await storedValue("error_report", "message", old.id)) as string
			).startsWith(SEALED),
		).toBe(true);

		const keys = await adminDb.$queryRaw<
			{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
		>`SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		try {
			expect(await sweepErrorReports(now)).toBeGreaterThanOrEqual(1);
		} finally {
			for (const k of keys)
				await adminDb.$executeRaw`
					INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
					VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
			evictInstanceKeyring();
		}
		expect((await rowsOf(bob)).map((r) => r.id)).toEqual([fresh.id]);
		expect(old.id).not.toBe(fresh.id);
	});
});

describe("a lost instance key", () => {
	// The global client (the admin's reader) keeps the ring it loaded for the
	// life of the process, so a key lost under a running server shows on the
	// next start; a client built after the loss is the same case. The route
	// answer for TextUnavailableError is response-guard.pg.test.ts.
	it("fails a fresh client's read with keystore_lost, never the empty fallback, and works again with the key back", async () => {
		const bob = (await person()).user.id;
		await send(bob, [report()]);
		const keys = await adminDb.$queryRaw<
			{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
		>`SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const failure = await createUserScopedDb(bob)
				.errorReport.findMany()
				.catch((e: unknown) => e);
			expect(failure).toBeInstanceOf(TextUnavailableError);
			expect((failure as TextUnavailableError).code).toBe("keystore_lost");
		} finally {
			vi.restoreAllMocks();
			for (const k of keys)
				await adminDb.$executeRaw`
					INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
					VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
			evictInstanceKeyring();
		}
		resetReloadsForTests();
		const [own] = await createUserScopedDb(bob).errorReport.findMany();
		expect(own?.message).toBe(MESSAGE_STORED);
	});

	it("deletes a report with the key gone, and a retry has nothing left to fail on", async () => {
		const bob = (await person()).user.id;
		await send(bob, [report()]);
		const [row] = await rowsOf(bob);
		const keys = await adminDb.$queryRaw<
			{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
		>`SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// A delete that returns the row would open its text after the
			// delete commits, fail, and leave the report gone with an error.
			await createUserScopedDb(bob).errorReport.delete({
				where: { id: row?.id ?? "" },
				select: { id: true },
			});
		} finally {
			vi.restoreAllMocks();
			for (const k of keys)
				await adminDb.$executeRaw`
					INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
					VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
			evictInstanceKeyring();
		}
		expect(await rowsOf(bob)).toEqual([]);
	});
});
