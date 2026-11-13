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
import { keystoreDb } from "~/server/db-core";
import { deleteGuestSessionAsAdmin } from "~/server/services/admin-person-removal.service";
import {
	migrateGuestDataForVerifiedUser,
	migrateGuestSessionsToUser,
} from "~/server/services/guest-migration.service";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
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
			expect.stringContaining("encrypted_text_unavailable"),
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(user.email);
		// The sealed address cannot be matched without the key, so the session stays.
		expect(await exists(guestId)).toBe(true);
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
