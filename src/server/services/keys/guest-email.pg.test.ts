/**
 * guest_session.email on the instance key (E2EE D11 Revision 3, PR 4, plan
 * docs/roadmap/e2ee-d11-rev3.md): resume mail, de-duplication, migration at
 * verification, deletion and the admin removal, all by address, once the
 * address is ciphertext (sealing on, the epoch set) and with sealing off.
 * Both modes run in both `pnpm test:pg` and `pnpm test:pg:sealed`; the file
 * sets its own master key, sealing and epoch, so the sealed suite excludes it
 * (sealed-suite.exclude.json). Expected hashes come from node:crypto
 * (contact-hash-expected.ts), not the code under test.
 */
import { randomUUID } from "node:crypto";
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
import { createCallerFactory } from "~/server/api/trpc";
import { guestRouter } from "~/server/api/routers/guest";
import { type FieldCryptoError, type Keyring, openField } from "~/server/crypto/field-crypto";
import { TextUnavailableError } from "~/server/crypto/field-open";
import { setSealingForTests } from "~/server/crypto/sealing";
import { auth } from "~/server/better-auth";
import { createUserScopedDb, db } from "~/server/db";
import { buildClients, keystoreDb, runtimeDataModel } from "~/server/db-core";
import { fieldOpenSlot } from "~/server/crypto/field-open";
import { buildModelGraph } from "~/server/crypto/model-graph";
import { textKeys } from "~/server/crypto/text-keys";
import type { PrismaClient } from "~prisma";
import { deleteGuestSessionAsAdmin } from "~/server/services/admin-person-removal.service";
import {
	migrateGuestDataForVerifiedUser,
	migrateGuestSessionsToUser,
} from "~/server/services/guest-migration.service";
import {
	evictInstanceKeyring,
	findInstanceKeyring,
} from "~/server/services/keys/instance-key.service";
import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import {
	anonymizeAndDeleteUser,
	previewAccountDeletion,
} from "~/server/services/user-deletion.service";
import { expectedContactHash, GUEST_LABEL } from "~/test/contact-hash-expected";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	instanceKeyring,
	newMasterKeyring,
	resetInstanceKey,
	storedValue,
	unsealAll,
	writeEpoch,
} from "~/test/sealed-fixture";
import { fillContactHashes } from "./contact-hash-fill";
import { contactLookup } from "./contact-hash";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const mail = vi.hoisted(() => ({ enabled: true, sent: [] as string[] }));
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => mail.enabled,
}));
vi.mock("~/server/mailer", () => ({
	sendEmail: async (to: string) => {
		mail.sent.push(to);
	},
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

const MASTER = newMasterKeyring();
const SEALED_PREFIX = "\u0001k1:";

type Mode = "sealed" | "plain";

/** sealed: master key, epoch and sealing on. plain: none of the three. */
async function setMode(mode: Mode) {
	evictInstanceKeyring();
	if (mode === "sealed") {
		master.ring = MASTER;
		await instanceKeyring(MASTER);
		await writeEpoch(true);
		setSealingForTests(() => true);
	} else {
		master.ring = undefined;
		await writeEpoch(false);
		setSealingForTests(() => false);
	}
}

let creator: Awaited<ReturnType<typeof createTestUser>>;
beforeAll(async () => {
	await resetInstanceKey();
	creator = await createTestUser();
});
afterAll(async () => {
	setSealingForTests();
	await writeEpoch(false);
	await unsealAll();
	await resetInstanceKey();
	master.ring = undefined;
});
afterEach(() => {
	mail.enabled = true;
	mail.sent.length = 0;
	vi.restoreAllMocks();
});

/** A project, its invite link, and the people who can register through it. */
async function link() {
	const project = await adminDb.project.create({
		data: { name: "Trip", createdById: creator.user.id },
	});
	return adminDb.magicLink.create({
		data: {
			id: randomUUID(),
			projectId: project.id,
			roleGranted: "CONTRIBUTOR",
			createdById: creator.user.id,
		},
	});
}

/** One registration, from its own address so the in-memory rate limit never counts two. */
const register = (linkId: string, email: string) =>
	createCallerFactory(guestRouter)({
		db: adminDb,
		session: null,
		headers: new Headers({ "x-forwarded-for": `ip-${randomUUID()}` }),
	}).register({ linkId, name: "Gus", email });

const address = (tag: string) => `${tag}-${randomUUID()}@example.com`;

async function created(linkId: string, email: string) {
	const out = await register(linkId, email);
	if (out.resumeEmailSent) throw new Error("expected a new session");
	return out.guestSessionId;
}

const rawRow = async (id: string) =>
	(
		await adminDb.$queryRaw<{ email: string; hash: string | null }[]>`
			SELECT "email", "emailHash" AS "hash" FROM "guest_session" WHERE "id" = ${id}`
	)[0];
const sessionsIn = async (projectId: string) =>
	Number(
		(
			await adminDb.$queryRaw<{ n: bigint }[]>`
				SELECT count(*) AS "n" FROM "guest_session" WHERE "projectId" = ${projectId}`
		)[0]?.n,
	);
const exists = async (id: string) => (await rawRow(id)) !== undefined;

/** A global client with no ring cached, as a restarted process has. */
function freshClient(): PrismaClient {
	const instance = () => findInstanceKeyring();
	return buildClients(
		{
			instance: textKeys({ instance }),
			user: (userId) => textKeys({ instance }, userId),
		},
		undefined,
		fieldOpenSlot(() => buildModelGraph(runtimeDataModel())),
	).db as unknown as PrismaClient;
}

/** Runs `run` with the instance key rows gone and no ring cached, then puts the rows back. */
async function withoutInstanceKey<T>(run: () => Promise<T>): Promise<T> {
	const keys = await adminDb.$queryRaw<
		{ keyId: number; wrappedKey: string; masterKeyId: bigint }[]
	>`SELECT "keyId", "wrappedKey", "masterKeyId" FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	evictInstanceKeyring();
	try {
		return await run();
	} finally {
		for (const k of keys)
			await adminDb.$executeRaw`
				INSERT INTO keystore."instance_text_key" ("keyId", "wrappedKey", "masterKeyId")
				VALUES (${k.keyId}, ${k.wrappedKey}, ${k.masterKeyId})`;
		evictInstanceKeyring();
	}
}

describe.each(["sealed", "plain"] as const)("guest email, %s", (mode) => {
	beforeEach(() => setMode(mode));

	it("stores the address as the mode says, with its hash whenever a key exists", async () => {
		const l = await link();
		const email = address("gus");
		const id = await created(l.id, email);
		const row = await rawRow(id);
		if (mode === "sealed") {
			expect(row?.email.startsWith(SEALED_PREFIX)).toBe(true);
			expect(row?.email).not.toContain("gus-");
			expect(
				openField(await instanceKeyring(MASTER), row?.email ?? "", {
					table: "guest_session",
					column: "email",
					rowId: id,
				}),
			).toBe(email);
			expect(row?.hash).toBe(
				expectedContactHash(await instanceKeyring(MASTER), GUEST_LABEL, email),
			);
		} else {
			expect(row?.email).toBe(email);
			expect(row?.hash).toBeNull();
		}
	});

	it("registering twice in another case sends the resume mail to the opened address and makes no second session", async () => {
		const l = await link();
		const email = address("rejoin");
		await created(l.id, email);
		const again = await register(l.id, email.toUpperCase());
		expect(again.resumeEmailSent).toBe(true);
		expect(mail.sent).toEqual([email]);
		expect(await sessionsIn(l.projectId)).toBe(1);
	});

	it("with no mail configured the second registration is a separate guest, as before", async () => {
		const l = await link();
		const email = address("nomail");
		await created(l.id, email);
		mail.enabled = false;
		await created(l.id, email.toUpperCase());
		expect(mail.sent).toEqual([]);
		expect(await sessionsIn(l.projectId)).toBe(2);
	});

	it("verification migrates the guest's sessions whatever the case of the account address", async () => {
		const l = await link();
		const email = address("mig");
		const guestId = await created(l.id, email);
		const { user } = await createTestUser();
		const result = await migrateGuestSessionsToUser(
			db,
			user.id,
			` ${email.toUpperCase()} `,
		);
		expect(result.migratedSessionCount).toBe(1);
		expect(await exists(guestId)).toBe(false);
		const member = await adminDb.projectParticipant.findFirst({
			where: {
				projectId: l.projectId,
				participantType: "user",
				participantId: user.id,
			},
			select: { id: true },
		});
		expect(member).not.toBeNull();
	});

	it("an account deletion removes the sessions of its address and no other", async () => {
		const l = await link();
		const { user } = await createTestUser();
		const mine = await created(l.id, user.email);
		const other = await created(l.id, address("other"));
		await anonymizeAndDeleteUser(db, user.id, user.email.toUpperCase(), null);
		expect(await exists(mine)).toBe(false);
		expect(await exists(other)).toBe(true);
	});

	it("the admin removal returns the opened address and deletes the session", async () => {
		const l = await link();
		const email = address("admin");
		const id = await created(l.id, email);
		const out = await deleteGuestSessionAsAdmin(db, {
			adminId: creator.user.id,
			id,
		});
		expect(out).toEqual({ name: "Gus", email });
		expect(await exists(id)).toBe(false);
	});

	// An address with _ or % is never a pattern: neither ILIKE wildcard may
	// reach another person's guest sessions (in sealed mode the hash decides).
	const stem = () => randomUUID().replaceAll("-", "");

	it("verifying john_doe@ migrates only john_doe@'s sessions, not johnxdoe@'s or john.doe@'s", async () => {
		const l = await link();
		const u = stem();
		const mine = await created(l.id, `${u}john_doe@example.com`);
		const others = [
			await created(l.id, `${u}johnxdoe@example.com`),
			await created(l.id, `${u}john.doe@example.com`),
		];
		const { user } = await createTestUser();
		const result = await migrateGuestSessionsToUser(
			db,
			user.id,
			`${u}John_Doe@Example.com`,
		);
		expect(result.migratedSessionCount).toBe(1);
		expect(await exists(mine)).toBe(false);
		expect(await Promise.all(others.map(exists))).toEqual([true, true]);
	});

	it("verifying an address with % migrates nothing", async () => {
		const l = await link();
		const u = stem();
		const guest = await created(l.id, `${u}xyz@example.com`);
		const { user } = await createTestUser();
		const result = await migrateGuestSessionsToUser(
			db,
			user.id,
			`${u}%@example.com`,
		);
		expect(result.migratedSessionCount).toBe(0);
		expect(await exists(guest)).toBe(true);
	});

	it("deleting the account john_doe@ deletes only john_doe@'s sessions", async () => {
		const l = await link();
		const u = stem();
		const mine = await created(l.id, `${u}john_doe@example.com`);
		const other = await created(l.id, `${u}johnxdoe@example.com`);
		const { user } = await createTestUser();
		await anonymizeAndDeleteUser(db, user.id, `${u}john_doe@example.com`, null);
		expect(await exists(mine)).toBe(false);
		expect(await exists(other)).toBe(true);
	});

	it("deleting an account whose address has % deletes no session", async () => {
		const l = await link();
		const u = stem();
		const guest = await created(l.id, `${u}xyz@example.com`);
		const { user } = await createTestUser();
		await anonymizeAndDeleteUser(db, user.id, `${u}%@example.com`, null);
		expect(await exists(guest)).toBe(true);
	});

	it("registering a_b@ does not resume axb@'s session, and a_b@ itself still resumes", async () => {
		const l = await link();
		const u = stem();
		await created(l.id, `${u}axb@example.com`);
		const separate = await register(l.id, `${u}a_b@example.com`);
		expect(separate.resumeEmailSent).toBe(false);
		expect(mail.sent).toEqual([]);
		const again = await register(l.id, `${u}A_B@example.com`);
		expect(again.resumeEmailSent).toBe(true);
		expect(mail.sent).toEqual([`${u}a_b@example.com`]);
		expect(await sessionsIn(l.projectId)).toBe(2);
	});

	it("an organizer reads the address, a contributor and a viewer read null", async () => {
		const l = await link();
		const email = address("seen");
		const guestId = await created(l.id, email);
		const people = await Promise.all(
			(["ORGANIZER", "CONTRIBUTOR", "VIEWER"] as const).map(async (role) => {
				const { user } = await createTestUser();
				await adminDb.projectParticipant.create({
					data: {
						projectId: l.projectId,
						participantType: "user",
						participantId: user.id,
						role,
					},
				});
				return user.id;
			}),
		);
		const [guest] = await db.guestSession.findMany({
			where: { id: guestId },
			select: { id: true, email: true },
		});
		const ref = { participantType: "guest", participantId: guestId };
		const seen = [];
		for (const id of people) {
			const visible = await buildContactVisibility(
				db,
				{ participantType: "user", participantId: id },
				[ref],
			);
			seen.push(redactContact({ ...ref, email: guest?.email ?? "" }, visible).email);
		}
		expect(seen).toEqual([email, null, null]);
	});
});

describe("a hash that cannot be made at verification", () => {
	beforeEach(() => setMode("sealed"));

	it("leaves the account verified and the guest in place, logs a stable code, and a later call migrates", async () => {
		const l = await link();
		const email = address("retry");
		const guestId = await created(l.id, email);
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { email, emailVerified: true },
			select: { id: true },
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		await withoutInstanceKey(async () => {
			expect(await migrateGuestDataForVerifiedUser(db, user.id)).toBeNull();
			expect(log).toHaveBeenCalledWith(
				"[Guest Migration Error]",
				"encrypted_text_unavailable",
			);
			expect(JSON.stringify(log.mock.calls)).not.toContain(email);
			expect(await exists(guestId)).toBe(true);
		});
		// The next sign-in runs it again: the session hook does not await it.
		const hook = auth.options.databaseHooks?.session?.create?.after;
		await hook?.({
			id: randomUUID(),
			userId: user.id,
			token: "t",
			expiresAt: new Date(Date.now() + 1000),
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		await vi.waitFor(async () => expect(await exists(guestId)).toBe(false));
	});
});

describe("sealed rows", () => {
	beforeEach(() => setMode("sealed"));

	it("a cell swapped between two guests fails auth_failed, never opens", async () => {
		const l = await link();
		const a = await created(l.id, address("a"));
		const b = await created(l.id, address("b"));
		const [ra, rb] = [await rawRow(a), await rawRow(b)];
		await adminDb.$executeRaw`UPDATE "guest_session" SET "email" = ${rb?.email} WHERE "id" = ${a}`;
		await adminDb.$executeRaw`UPDATE "guest_session" SET "email" = ${ra?.email} WHERE "id" = ${b}`;
		vi.spyOn(console, "error").mockImplementation(() => {});
		for (const id of [a, b]) {
			const failure = await db.guestSession
				.findUnique({ where: { id }, select: { email: true } })
				.catch((e: unknown) => e);
			expect((failure as FieldCryptoError).code).toBe("auth_failed");
		}
	});

	it("a legacy plaintext row still reads, and is found by hash once the fill has run", async () => {
		const l = await link();
		const email = address("legacy");
		const id = await created(l.id, email);
		await adminDb.$executeRaw`UPDATE "guest_session" SET "email" = ${email}, "emailHash" = NULL WHERE "id" = ${id}`;
		expect(
			(await db.guestSession.findUnique({ where: { id }, select: { email: true } }))?.email,
		).toBe(email);
		expect(await storedValue("guest_session", "email", id)).toBe(email);

		const ring = await instanceKeyring(MASTER);
		await fillContactHashes(keystoreDb, ring, "guest_session");
		const found = await db.guestSession.findMany({
			where: await contactLookup("guest_session", email.toUpperCase()),
			select: { id: true },
		});
		expect(found.map((r) => r.id)).toEqual([id]);
		expect(await storedValue("guest_session", "email", id)).toBe(email);
	});

	it("a lost instance key fails registration with the stable code and makes no session", async () => {
		const l = await link();
		await withoutInstanceKey(async () => {
			await expect(register(l.id, address("lost"))).rejects.toMatchObject({
				cause: expect.any(TextUnavailableError),
			});
		});
		expect(await sessionsIn(l.projectId)).toBe(0);
	});

	it("an account deletion with the instance key lost still deletes, skips the by-address match and logs the code", async () => {
		const l = await link();
		const { user } = await createTestUser();
		const guestId = await created(l.id, user.email);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await withoutInstanceKey(async () => {
			await anonymizeAndDeleteUser(db, user.id, user.email, null);
		});
		expect(await adminDb.user.count({ where: { id: user.id } })).toBe(0);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("keystore_lost"),
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(user.email);
		// The sealed address cannot be matched without the key, so the session stays.
		expect(await exists(guestId)).toBe(true);
	});

	it("the deletion preview names what it can read and gives null for a name whose key is lost", async () => {
		const { user: gone } = await createTestUser();
		const { user: other } = await createTestUser();
		const shared = await adminDb.project.create({
			data: { name: "Bariloche", createdById: gone.id },
		});
		const solo = await adminDb.project.create({
			data: { name: "Alquiler", createdById: gone.id },
		});
		await adminDb.projectParticipant.createMany({
			data: [
				{ projectId: shared.id, participantType: "user", participantId: gone.id, role: "ORGANIZER" },
				{ projectId: shared.id, participantType: "user", participantId: other.id, role: "CONTRIBUTOR" },
				{ projectId: solo.id, participantType: "user", participantId: gone.id, role: "ORGANIZER" },
			],
		});
		const withKey = await previewAccountDeletion(db, gone.id);
		expect(withKey.projectsToTransfer).toEqual([
			{ id: shared.id, name: "Bariloche", newOrganizerName: other.name },
		]);
		expect(withKey.projectsToDelete).toEqual([{ id: solo.id, name: "Alquiler" }]);

		vi.spyOn(console, "error").mockImplementation(() => {});
		const lost = await withoutInstanceKey(() =>
			previewAccountDeletion(freshClient(), gone.id),
		);
		expect(lost.projectsToTransfer).toEqual([
			{ id: shared.id, name: null, newOrganizerName: null },
		]);
		expect(lost.projectsToDelete).toEqual([{ id: solo.id, name: null }]);
	});

	it("an account with an organized project, a created project and a pending settlement deletes with the instance key lost", async () => {
		const creatorUser = await createTestUser();
		const { user: other } = await createTestUser();
		const gone = creatorUser.user.id;
		// P1: organized and created by `gone`, with another member to inherit it.
		const p1 = await adminDb.project.create({
			data: { name: "Compartido", createdById: gone },
		});
		await adminDb.projectParticipant.createMany({
			data: [
				{ projectId: p1.id, participantType: "user", participantId: gone, role: "ORGANIZER" },
				{ projectId: p1.id, participantType: "user", participantId: other.id, role: "CONTRIBUTOR" },
			],
		});
		// P2: organized by `gone` alone, so it is deleted with them.
		const p2 = await adminDb.project.create({
			data: { name: "Solo", createdById: gone },
		});
		await adminDb.projectParticipant.create({
			data: { projectId: p2.id, participantType: "user", participantId: gone, role: "ORGANIZER" },
		});
		// A payment `gone` recorded and `other` has not confirmed: auto-confirmed.
		const settlement = await adminDb.settlement.create({
			data: {
				fromParticipantType: "user",
				fromParticipantId: gone,
				toParticipantType: "user",
				toParticipantId: other.id,
				amount: "30000",
				currency: "ARS",
				note: "Cena",
				confirmedByPayer: true,
			},
			select: { id: true },
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		await withoutInstanceKey(async () => {
			await anonymizeAndDeleteUser(
				freshClient(),
				gone,
				creatorUser.user.email,
				null,
			);
		});
		expect(await adminDb.user.count({ where: { id: gone } })).toBe(0);
		const [heir] = await adminDb.$queryRaw<{ createdById: string }[]>`
			SELECT "createdById" FROM "project" WHERE "id" = ${p1.id}`;
		expect(heir?.createdById).toBe(other.id);
		expect(
			(await adminDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS "n" FROM "project" WHERE "id" = ${p2.id}`)[0]?.n,
		).toBe(0n);
		const [row] = await adminDb.$queryRaw<{ status: string; payer: boolean; payee: boolean }[]>`
			SELECT "status"::text AS "status", "confirmedByPayer" AS "payer", "confirmedByPayee" AS "payee"
			FROM "settlement" WHERE "id" = ${settlement.id}`;
		expect(row).toEqual({ status: "FINALIZED", payer: true, payee: true });
	});

	it("a delete, an update and a bulk delete that return no address succeed with the key unavailable", async () => {
		const l = await link();
		const [a, b, c] = [
			await created(l.id, address("k1")),
			await created(l.id, address("k2")),
			await created(l.id, address("k3")),
		];
		vi.spyOn(console, "error").mockImplementation(() => {});
		await withoutInstanceKey(async () => {
			// A fresh client holds no ring, as a restarted process would.
			const fresh = createUserScopedDb(creator.user.id);
			await fresh.guestSession.update({
				where: { id: a },
				select: { id: true },
				data: { lastActiveAt: new Date() },
			});
			await fresh.guestSession.delete({ where: { id: b }, select: { id: true } });
			expect(
				(await fresh.guestSession.deleteMany({ where: { id: c } })).count,
			).toBe(1);
			// What the same delete does when it returns the row.
			const failure = await createUserScopedDb(creator.user.id)
				.guestSession.delete({ where: { id: a } })
				.catch((e: unknown) => e);
			expect((failure as TextUnavailableError).code).toBe("keystore_lost");
		});
		expect([await exists(b), await exists(c)]).toEqual([false, false]);
	});
});
