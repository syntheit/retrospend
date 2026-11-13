/**
 * A ghost's email and phone on the creator's key (E2EE D11 Revision 3, PR 3b)
 * on real Postgres, with sealing turned on and off inside the file (it sets
 * its own master key and epoch, so the sealed suite runs it as it is,
 * sealed-suite.exclude.json). Hand-derived expectations:
 *
 *   sealing on, creator writes     -> email and phone are `\u0001k1:` at rest, emailHash is
 *                                     tag:hex of the trimmed, ASCII-lower-cased address, the
 *                                     creator reads plaintext, the response carries the address
 *   rename without an email        -> the sealed cell is not rewritten
 *   a cell copied to another ghost -> auth_failed for its creator (AAD names the row)
 *   a cell copied to another's row -> read by the first creator it is hidden (null), never tried
 *   a project EDITOR, the global client, the admin list -> null, never an error
 *   creator's key lost             -> any read that opens the address fails keystore_lost; a rename
 *                                     of the name, an admin delete and a handover still succeed
 *   handover to an heir            -> sealed email and phone become null, emailHash stays, the
 *                                     ghost still claims; a plaintext ghost keeps both cells
 *   claim by "Bob@Example.com" vs "bob@example.com", hash path and plaintext path -> same ghost
 *   "JOSÉ" vs "josÉ" vs "josé"     -> only the first two match (ASCII fold), on both paths
 *
 * Every test makes its own users, so a key deleted in one does not reach another.
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
import { createCallerFactory } from "~/server/api/trpc";
import { peopleRouter } from "~/server/api/routers/people";
import { type Keyring, openField } from "~/server/crypto/field-crypto";
import { TextUnavailableError } from "~/server/crypto/field-open";
import { setSealingForTests } from "~/server/crypto/sealing";
import { resetReloadsForTests } from "~/server/crypto/text-keys";
import { createUserScopedDb, db } from "~/server/db";
import { keystoreDb } from "~/server/db-core";
import { deleteShadowProfileAsAdmin } from "~/server/services/admin-person-removal.service";
import { migrateGuestSessionsToUser } from "~/server/services/guest-migration.service";
import { fillContactHashes } from "~/server/services/keys/contact-hash-fill";
import { evictDataKeyring } from "~/server/services/keys/data-key.service";
import { evictInstanceKeyring } from "~/server/services/keys/instance-key.service";
import {
	addShadow,
	renameShadow,
} from "~/server/services/shadow-profile.service";
import {
	redactParticipantEmails,
	resolveParticipantNames,
} from "~/server/services/project/identities";
import {
	type PrismaTx,
	retireGhosts,
} from "~/server/services/user-deletion-ghosts";
import { expectedContactHash, SHADOW_LABEL } from "~/test/contact-hash-expected";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	instanceKeyring,
	resetInstanceKey,
	sealedFile,
	unsealAll,
	userKeyring,
	writeEpoch,
} from "~/test/sealed-fixture";
import { makeSession } from "~/test/trpc-test-utils";

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

let MASTER: Keyring;
sealedFile(master);
beforeAll(() => {
	MASTER = master.ring as Keyring;
});
afterAll(async () => {
	setSealingForTests();
	await writeEpoch(false);
	await unsealAll();
	evictInstanceKeyring();
});

/** Sealing on: master key, epoch and the seal path. Off: none of them, as a plain install. */
async function mode(on: boolean) {
	setSealingForTests(() => on);
	await writeEpoch(on);
	master.ring = on ? MASTER : undefined;
	evictInstanceKeyring();
	resetReloadsForTests();
}
beforeEach(() => mode(true));

type User = Awaited<ReturnType<typeof createTestUser>>;
const tag = () => randomUUID().slice(0, 8);
const as = (u: User) => ({ id: u.user.id, name: u.user.name });

interface Raw {
	email: string | null;
	phone: string | null;
	emailHash: string | null;
	createdById: string;
}
const raw = async (id: string): Promise<Raw> => {
	const [row] = await adminDb.$queryRaw<Raw[]>`
		SELECT "email", "phone", "emailHash", "createdById" FROM "shadow_profile" WHERE "id" = ${id}`;
	if (!row) throw new Error("no ghost");
	return row;
};
const isSealed = (value: string | null) => value?.startsWith("\u0001k1:");
const hashFor = async (normalized: string) =>
	expectedContactHash(await instanceKeyring(MASTER), SHADOW_LABEL, normalized);

async function ghost(u: User, email?: string, name = "Bob") {
	const out = await addShadow(u.db, as(u), { name, email });
	if (out.kind !== "shadow") throw new Error("not a ghost");
	return out;
}

/** A project with `members` and the ghost in it, so RLS lets the members read the ghost. */
async function projectWith(
	owner: User,
	members: { user: User; role: "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" }[],
	ghostId: string,
) {
	const project = await adminDb.project.create({
		data: { name: "Trip", createdById: owner.user.id },
	});
	for (const m of [{ user: owner, role: "ORGANIZER" as const }, ...members])
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: m.user.user.id,
				role: m.role,
			},
		});
	await adminDb.projectParticipant.create({
		data: {
			projectId: project.id,
			participantType: "shadow",
			participantId: ghostId,
			role: "CONTRIBUTOR",
		},
	});
	return project.id;
}

describe("at rest, with sealing on", () => {
	it("seals the email and phone with the creator's key, stores the hash, and the creator reads plaintext", async () => {
		const creator = await createTestUser();
		const email = `Bob-${randomUUID().slice(0, 8)}@Example.com`;
		const made = await ghost(creator, email);
		// The write returns the address it was given, not a re-opened cell.
		expect(made.email).toBe(email);
		await creator.db.shadowProfile.update({
			where: { id: made.id },
			data: { phone: "+54 11 5555 0000" },
			select: { id: true },
		});

		const stored = await raw(made.id);
		expect(isSealed(stored.email)).toBe(true);
		expect(isSealed(stored.phone)).toBe(true);
		expect(JSON.stringify(stored)).not.toContain(email);
		expect(JSON.stringify(stored)).not.toContain("5555");
		expect(stored.emailHash).toBe(await hashFor(email.toLowerCase()));

		const read = await creator.db.shadowProfile.findUnique({
			where: { id: made.id },
			select: { email: true, phone: true },
		});
		expect(read).toEqual({ email, phone: "+54 11 5555 0000" });
	});

	it("rename with an address seals it again and moves the hash; a rename of the name leaves the cell as it was", async () => {
		const creator = await createTestUser();
		const made = await ghost(creator, `a-${randomUUID().slice(0, 8)}@example.com`);
		const before = (await raw(made.id)).email;

		const renamed = await renameShadow(creator.db, creator.user.id, {
			id: made.id,
			name: "Robert",
		});
		expect(renamed.email).toBe(
			(
				await creator.db.shadowProfile.findUnique({
					where: { id: made.id },
					select: { email: true },
				})
			)?.email,
		);
		expect((await raw(made.id)).email).toBe(before);

		const next = `Rob-${randomUUID().slice(0, 8)}@Example.com`;
		const again = await renameShadow(creator.db, creator.user.id, {
			id: made.id,
			name: "Robert",
			email: ` ${next} `,
		});
		expect(again.email).toBe(` ${next} `);
		const stored = await raw(made.id);
		expect(isSealed(stored.email)).toBe(true);
		expect(stored.email).not.toBe(before);
		expect(stored.emailHash).toBe(await hashFor(next.toLowerCase()));

		await renameShadow(creator.db, creator.user.id, {
			id: made.id,
			name: "Robert",
			email: null,
		});
		expect(await raw(made.id)).toMatchObject({ email: null, emailHash: null });
	});

	it("a cell copied to another ghost fails auth_failed for its creator, and into another creator's row it is hidden, never tried", async () => {
		const creator = await createTestUser();
		const stranger = await createTestUser();
		const a = await ghost(creator, `a-${randomUUID().slice(0, 8)}@example.com`);
		const b = await ghost(creator, `b-${randomUUID().slice(0, 8)}@example.com`);
		const theirs = await ghost(stranger, `c-${randomUUID().slice(0, 8)}@example.com`);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await adminDb.$executeRaw`
			UPDATE "shadow_profile" SET "email" = (SELECT "email" FROM "shadow_profile" WHERE "id" = ${a.id})
			WHERE "id" IN (${b.id}, ${theirs.id})`;

		const failure = await creator.db.shadowProfile
			.findUnique({ where: { id: b.id }, select: { email: true } })
			.catch((e: unknown) => e);
		expect(failure).toMatchObject({ code: "auth_failed" });

		// Read by the key's own owner through a project that shares the row:
		// she is not the creator of `theirs`, so the cell is not hers to open.
		await projectWith(stranger, [{ user: creator, role: "EDITOR" }], theirs.id);
		expect(
			await creator.db.shadowProfile.findUnique({
				where: { id: theirs.id },
				select: { email: true },
			}),
		).toEqual({ email: null });
	});
});

describe("what other readers see", () => {
	it("a project EDITOR, a viewer of the global client and the people search get null, and no error", async () => {
		const creator = await createTestUser();
		const editor = await createTestUser();
		const tag = randomUUID().slice(0, 8);
		const email = `erin-${tag}@secret.test`;
		const made = await ghost(creator, email, `Erin ${tag}`);
		await projectWith(creator, [{ user: editor, role: "EDITOR" }], made.id);

		expect(
			await editor.db.shadowProfile.findUnique({
				where: { id: made.id },
				select: { name: true, email: true, phone: true },
			}),
		).toEqual({ name: `Erin ${tag}`, email: null, phone: null });
		expect(
			await db.shadowProfile.findUnique({
				where: { id: made.id },
				select: { email: true },
			}),
		).toEqual({ email: null });

		const asEditor = createCallerFactory(peopleRouter)({
			session: makeSession(as(editor)),
			db: editor.db,
			headers: new Headers(),
		});
		expect((await asEditor.search({ query: `erin-${tag}` })).shadows).toEqual([]);
		const byName = await asEditor.search({ query: `erin ${tag}` });
		expect(byName.shadows).toEqual([
			expect.objectContaining({ participantId: made.id, email: null }),
		]);

		// The project views: resolved, then redacted by the one visibility rule.
		const rows = [{ participantType: "shadow", participantId: made.id }];
		const seen = async (u: User) =>
			(
				await redactParticipantEmails(
					u.db,
					{ participantType: "user", participantId: u.user.id },
					await resolveParticipantNames(u.db, rows),
				)
			)[0]?.email;
		expect(await seen(editor)).toBeNull();
		expect(await seen(creator)).toBe(email);

		const asCreator = createCallerFactory(peopleRouter)({
			session: makeSession(as(creator)),
			db: creator.db,
			headers: new Headers(),
		});
		expect(
			(await asCreator.search({ query: `erin-${tag}` })).shadows,
		).toEqual([expect.objectContaining({ participantId: made.id, email })]);
	});
});

describe("when the creator's key is unavailable", () => {
	async function losing() {
		const creator = await createTestUser();
		const made = await ghost(creator, `lost-${randomUUID().slice(0, 8)}@example.com`);
		await adminDb.$executeRaw`DELETE FROM keystore."user_data_key" WHERE "userId" = ${creator.user.id}`;
		evictDataKeyring(creator.user.id);
		resetReloadsForTests();
		vi.spyOn(console, "error").mockImplementation(() => {});
		return { creator, made, fresh: createUserScopedDb(creator.user.id) };
	}

	it("a read that opens the address fails keystore_lost, and one that does not still works", async () => {
		const { made, fresh } = await losing();
		const failure = await fresh.shadowProfile
			.findUnique({ where: { id: made.id }, select: { email: true } })
			.catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(TextUnavailableError);
		expect((failure as TextUnavailableError).code).toBe("keystore_lost");
		expect(
			await fresh.shadowProfile.findUnique({
				where: { id: made.id },
				select: { id: true, name: true },
			}),
		).toMatchObject({ name: "Bob" });
	});

	it("a rename of the name and an admin delete succeed: no write returns the sealed cell", async () => {
		const { creator, made, fresh } = await losing();
		const before = (await raw(made.id)).email;
		const renamed = await renameShadow(fresh, creator.user.id, {
			id: made.id,
			name: "Still works",
		});
		expect(renamed).toMatchObject({ name: "Still works", email: null });
		expect((await raw(made.id)).email).toBe(before);

		const admin = await createTestUser({ role: "ADMIN" });
		await expect(
			deleteShadowProfileAsAdmin(db, { adminId: admin.user.id, id: made.id }),
		).resolves.toEqual({ name: "Still works" });
		expect(await adminDb.shadowProfile.count({ where: { id: made.id } })).toBe(0);
	});

	it("a new ghost with an address fails closed and stores nothing", async () => {
		const { creator, fresh } = await losing();
		const had = await adminDb.shadowProfile.count({
			where: { createdById: creator.user.id },
		});
		const failure = await addShadow(fresh, as(creator), {
			name: "New",
			email: "new@example.com",
		}).catch((e: unknown) => e);
		expect(failure).toMatchObject({ code: "keystore_lost" });
		expect(
			await adminDb.shadowProfile.count({ where: { createdById: creator.user.id } }),
		).toBe(had);
	});

	it("a handover to an heir succeeds and clears the sealed cells the heir could not open", async () => {
		const { creator, made } = await losing();
		const heir = await createTestUser();
		await projectWith(creator, [{ user: heir, role: "EDITOR" }], made.id);
		await db.$transaction((tx) =>
			retireGhosts(tx as unknown as PrismaTx, creator.user.id),
		);
		expect(await raw(made.id)).toMatchObject({
			email: null,
			createdById: heir.user.id,
		});
	});
});

describe("the handover to an heir", () => {
	async function handOver(sealingOn: boolean) {
		const creator = await createTestUser();
		const heir = await createTestUser();
		const tag = randomUUID().slice(0, 8);
		const email = `Heir-${tag}@Example.com`;
		await mode(sealingOn);
		const made = await ghost(creator, email);
		await creator.db.shadowProfile.update({
			where: { id: made.id },
			data: { phone: "+54 11 4444 0000" },
			select: { id: true },
		});
		// Hashed the same on both paths once the hash exists (rule 3 of contact-hash.ts).
		await mode(true);
		await fillContactHashes(
			keystoreDb,
			await instanceKeyring(MASTER),
			"shadow_profile",
		);
		await projectWith(creator, [{ user: heir, role: "EDITOR" }], made.id);
		const before = await raw(made.id);
		await db.$transaction((tx) =>
			retireGhosts(tx as unknown as PrismaTx, creator.user.id),
		);
		return { creator, heir, made, tag, email, before, after: await raw(made.id) };
	}

	it("nulls a sealed email and phone, keeps emailHash, and the heir reads null without an error", async () => {
		const { heir, made, before, after } = await handOver(true);
		expect(isSealed(before.email)).toBe(true);
		expect(after).toMatchObject({
			email: null,
			phone: null,
			createdById: heir.user.id,
			emailHash: before.emailHash,
		});
		expect(
			await heir.db.shadowProfile.findUnique({
				where: { id: made.id },
				select: { email: true, phone: true },
			}),
		).toEqual({ email: null, phone: null });
	});

	it("still claims by address after the handover, by the hash", async () => {
		const { made, tag } = await handOver(true);
		const claimer = await createTestUser();
		const result = await migrateGuestSessionsToUser(
			db,
			claimer.user.id,
			`  HEIR-${tag}@example.COM `,
		);
		expect(result.claimedShadowCount).toBe(1);
		expect(await adminDb.shadowProfile.count({ where: { id: made.id } })).toBe(0);
	});

	it("leaves a plaintext email and phone as they were (a ghost saved before sealing)", async () => {
		const { heir, made, email, before, after } = await handOver(false);
		expect(before.email).toBe(email);
		expect(after).toMatchObject({
			email,
			phone: "+54 11 4444 0000",
			createdById: heir.user.id,
			emailHash: before.emailHash,
		});
	});
});

describe("claiming a ghost by the address of a verified user", () => {
	async function claims(
		ghostEmail: string,
		userEmail: string,
		sealingOn: boolean,
	): Promise<number> {
		const creator = await createTestUser();
		await mode(sealingOn);
		const made = await ghost(creator, ghostEmail);
		if (sealingOn) expect(isSealed((await raw(made.id)).email)).toBe(true);
		else expect((await raw(made.id)).email).toBe(ghostEmail);
		const claimer = await createTestUser();
		const result = await migrateGuestSessionsToUser(db, claimer.user.id, userEmail);
		const gone = (await adminDb.shadowProfile.count({ where: { id: made.id } })) === 0;
		expect(gone).toBe(result.claimedShadowCount === 1);
		return result.claimedShadowCount;
	}

	it.each([
		["the hash path (sealing on)", true],
		["the plaintext path (sealing off)", false],
	])("Bob@Example.com and bob@example.com are the same person on %s", async (_name, on) => {
		const t = tag();
		expect(await claims(`Bob-${t}@Example.com`, ` bob-${t}@example.COM `, on)).toBe(1);
		const u = tag();
		expect(await claims(`bob-${u}@example.com`, `BOB-${u}@EXAMPLE.COM`, on)).toBe(1);
		expect(await claims(`bob-${tag()}@example.com`, `bob-${tag()}@example.com`, on)).toBe(0);
	});

	it.each([
		["the hash path (sealing on)", true],
		["the plaintext path (sealing off)", false],
	])("a non-ASCII address matches only with the same accented letters on %s", async (_name, on) => {
		const t = tag();
		expect(await claims(`JOSÉ-${t}@Example.com`, `josÉ-${t}@example.COM`, on)).toBe(1);
		// Postgres folds É to é in a UTF-8 locale and returns the row; the exact check says no.
		const u = tag();
		expect(await claims(`JOSÉ-${u}@Example.com`, `josé-${u}@example.com`, on)).toBe(0);
	});

	it("claims a ghost saved before sealing, through the filled hash, after the epoch", async () => {
		const creator = await createTestUser();
		await mode(false);
		const t = tag();
		const made = await ghost(creator, `Old-${t}@Example.com`);
		expect((await raw(made.id)).emailHash).toBeNull();
		await mode(true);
		await fillContactHashes(keystoreDb, await instanceKeyring(MASTER), "shadow_profile");
		expect((await raw(made.id)).email).toBe(`Old-${t}@Example.com`);
		const claimer = await createTestUser();
		const result = await migrateGuestSessionsToUser(db, claimer.user.id, `old-${t}@example.com`);
		expect(result.claimedShadowCount).toBe(1);
	});
});

describe("which key seals the cell", () => {
	it("opens with the creator's ring and not with another user's", async () => {
		const creator = await createTestUser();
		const other = await createTestUser();
		const made = await ghost(creator, `k-${randomUUID().slice(0, 8)}@example.com`);
		const stored = (await raw(made.id)).email ?? "";
		const aad = { table: "shadow_profile", column: "email", rowId: made.id };
		const own = await userKeyring(creator.user.id, MASTER);
		const stranger = await userKeyring(other.user.id, MASTER);
		expect(openField(own, stored, aad)).toContain("@example.com");
		expect(() => openField(stranger, stored, aad)).toThrow();
	});
});

describe("a lost instance key", () => {
	it("fails the migration, not silently matches nothing, when the hash cannot be made", async () => {
		const creator = await createTestUser();
		const claimer = await createTestUser();
		const t = tag();
		await ghost(creator, `x-${t}@example.com`);
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await expect(
				migrateGuestSessionsToUser(db, claimer.user.id, `x-${t}@example.com`),
			).rejects.toBeInstanceOf(TextUnavailableError);
		} finally {
			// Instance cells sealed before this carry the old key: nothing after reads them.
			await resetInstanceKey();
		}
	});
});
