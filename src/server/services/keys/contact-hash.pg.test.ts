/**
 * The contact hash writers on real Postgres (E2EE D11 Revision 3, PR 3a): what
 * the shadow and guest writers store in "emailHash" under each case of the
 * one rule (contact-hash.ts), the lookup, the fill, and the migration's
 * rollback snippet. The expected hashes are derived here with node:crypto
 * from the key the ring holds, not read from the code under test.
 *
 * It sets its own master key and epoch, so the sealed suite runs it as it is
 * (sealed-suite.exclude.json).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { guestRouter } from "~/server/api/routers/guest";
import { peopleRouter } from "~/server/api/routers/people";
import { TextUnavailableError } from "~/server/crypto/field-open";
import type { Keyring } from "~/server/crypto/field-crypto";
import { keystoreDb } from "~/server/db-core";
import {
	addShadow,
	renameShadow,
} from "~/server/services/shadow-profile.service";
import {
	expectedContactHash,
	GUEST_LABEL,
	SHADOW_LABEL,
} from "~/test/contact-hash-expected";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import {
	instanceKeyring,
	newMasterKeyring,
	resetInstanceKey,
	writeEpoch,
} from "~/test/sealed-fixture";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { makeSession } from "~/test/trpc-test-utils";
import { contactLookup } from "./contact-hash";
import { fillContactHashes } from "./contact-hash-fill";
import { evictInstanceKeyring } from "./instance-key.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

const MASTER = newMasterKeyring();
const useMaster = (on: boolean) => {
	master.ring = on ? MASTER : undefined;
	evictInstanceKeyring();
};

const SHADOW = SHADOW_LABEL;
const GUEST = GUEST_LABEL;

/** The expected hash under the instance key as it stands now. */
async function expected(label: string, text: string) {
	return expectedContactHash(await instanceKeyring(MASTER), label, text);
}

const hashOf = async (table: "shadow_profile" | "guest_session", id: string) =>
	(
		await adminDb.$queryRawUnsafe<{ h: string | null }[]>(
			`SELECT "emailHash" AS "h" FROM "${table}" WHERE "id" = $1`,
			id,
		)
	)[0]?.h;
const emailOf = async (table: "shadow_profile" | "guest_session", id: string) =>
	(
		await adminDb.$queryRawUnsafe<{ e: string | null }[]>(
			`SELECT "email" AS "e" FROM "${table}" WHERE "id" = $1`,
			id,
		)
	)[0]?.e;
const instanceKeys = async () =>
	Number(
		(
			await adminDb.$queryRaw<{ n: bigint }[]>`
				SELECT count(*) AS "n" FROM keystore."instance_text_key"`
		)[0]?.n,
	);

let creator: Awaited<ReturnType<typeof createTestUser>>;
const as = () => ({ id: creator.user.id, name: creator.user.name });
const add = (email?: string, name = "Bob") =>
	addShadow(creator.db, as(), { name, email });

beforeAll(async () => {
	creator = await createTestUser();
});
beforeEach(async () => {
	await resetInstanceKey();
	await writeEpoch(false);
	useMaster(true);
});
afterAll(async () => {
	await writeEpoch(false);
	await resetInstanceKey();
	evictInstanceKeyring();
});

describe("with no master key", () => {
	it("stores no hash, never throws, even with the epoch set", async () => {
		useMaster(false);
		const first = await add("Bob@Example.com");
		expect(first.kind).toBe("shadow");
		const id = first.kind === "shadow" ? first.id : "";
		expect(await hashOf("shadow_profile", id)).toBeNull();
		await writeEpoch(true);
		await renameShadow(creator.db, creator.user.id, {
			id,
			name: "Bob",
			email: "other@example.com",
		});
		expect(await emailOf("shadow_profile", id)).toBe("other@example.com");
		expect(await hashOf("shadow_profile", id)).toBeNull();
		expect(await instanceKeys()).toBe(0);
	});
});

describe("with a master key and no epoch (rule 3)", () => {
	it("stores the hash of the trimmed, lower-cased address when a ring exists", async () => {
		await instanceKeyring(MASTER);
		const out = await add("Bob@Example.com");
		const id = out.kind === "shadow" ? out.id : "";
		// The email itself is stored as typed.
		expect(await emailOf("shadow_profile", id)).toBe("Bob@Example.com");
		expect(await hashOf("shadow_profile", id)).toBe(
			await expected(SHADOW, "bob@example.com"),
		);
	});

	it("follows the address on rename, and leaves it alone when the rename has none", async () => {
		await instanceKeyring(MASTER);
		const out = await add("Bob@Example.com");
		const id = out.kind === "shadow" ? out.id : "";
		const before = await hashOf("shadow_profile", id);
		await renameShadow(creator.db, creator.user.id, { id, name: "Robert" });
		expect(await hashOf("shadow_profile", id)).toBe(before);
		await renameShadow(creator.db, creator.user.id, {
			id,
			name: "Robert",
			email: " Rob@Example.COM ",
		});
		expect(await hashOf("shadow_profile", id)).toBe(
			await expected(SHADOW, "rob@example.com"),
		);
		await renameShadow(creator.db, creator.user.id, {
			id,
			name: "Robert",
			email: null,
		});
		expect(await emailOf("shadow_profile", id)).toBeNull();
		expect(await hashOf("shadow_profile", id)).toBeNull();
	});

	it("never makes the ring: with none, the row has no hash and no key exists", async () => {
		const out = await add("Bob@Example.com");
		const id = out.kind === "shadow" ? out.id : "";
		expect(await hashOf("shadow_profile", id)).toBeNull();
		expect(await instanceKeys()).toBe(0);
		// The row written in that window is what the start-up fill takes.
		const ring = await instanceKeyring(MASTER);
		expect(
			await fillContactHashes(keystoreDb, ring, "shadow_profile"),
		).toBeGreaterThanOrEqual(1);
		expect(await hashOf("shadow_profile", id)).toBe(
			await expected(SHADOW, "bob@example.com"),
		);
		expect(await emailOf("shadow_profile", id)).toBe("Bob@Example.com");
	});
});

describe("with a master key and the epoch set (rule 2)", () => {
	it("a writer before the epoch has no ring to use, one after makes it and stores the hash", async () => {
		const before = await add("Before@Example.com");
		expect(
			await hashOf("shadow_profile", before.kind === "shadow" ? before.id : ""),
		).toBeNull();
		expect(await instanceKeys()).toBe(0);

		await writeEpoch(true);
		const after = await add("After@Example.com", "Ann");
		expect(await instanceKeys()).toBe(1);
		expect(
			await hashOf("shadow_profile", after.kind === "shadow" ? after.id : ""),
		).toBe(await expected(SHADOW, "after@example.com"));
	});

	it("a lost instance key fails the write closed with the stable code and stores nothing", async () => {
		await instanceKeyring(MASTER);
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		await writeEpoch(true);
		const owned = () =>
			adminDb.shadowProfile.count({ where: { createdById: creator.user.id } });
		const had = await owned();
		const error = await add("a@example.com").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TextUnavailableError);
		expect((error as TextUnavailableError).code).toBe("keystore_lost");
		expect(await owned()).toBe(had);
	});
});

describe("the guest writer", () => {
	const caller = () =>
		createCallerFactory(guestRouter)({
			db: adminDb,
			session: null,
			headers: new Headers(),
		});
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

	it("registers with the guest label, no hash without a ring or a master key", async () => {
		const l = await link();
		useMaster(false);
		const plain = await caller().register({
			linkId: l.id,
			name: "Gus",
			email: "Gus@Example.com",
		});
		if (!plain.guestSessionId) throw new Error("no session");
		expect(await emailOf("guest_session", plain.guestSessionId)).toBe(
			"gus@example.com",
		);
		expect(await hashOf("guest_session", plain.guestSessionId)).toBeNull();

		useMaster(true);
		await instanceKeyring(MASTER);
		const hashed = await caller().register({
			linkId: l.id,
			name: "Gus",
			email: "Gus@Example.com",
		});
		if (!hashed.guestSessionId) throw new Error("no session");
		expect(await hashOf("guest_session", hashed.guestSessionId)).toBe(
			await expected(GUEST, "gus@example.com"),
		);
		// A guest and a ghost with one address do not share a hash.
		expect(await expected(GUEST, "gus@example.com")).not.toBe(
			await expected(SHADOW, "gus@example.com"),
		);
	});

	it("fails closed with an epoch and no ring, and makes no session", async () => {
		const l = await link();
		await instanceKeyring(MASTER);
		await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
		evictInstanceKeyring();
		await writeEpoch(true);
		const email = `lost-${randomUUID()}@example.com`;
		await expect(
			caller().register({ linkId: l.id, name: "Gus", email }),
		).rejects.toMatchObject({ cause: expect.any(TextUnavailableError) });
		expect(
			(
				await adminDb.$queryRaw<{ n: bigint }[]>`
					SELECT count(*) AS "n" FROM "guest_session" WHERE "email" = ${email}`
			)[0]?.n,
		).toBe(0n);
	});
});

describe("contactLookup on rows", () => {
	it("before the epoch matches the plaintext address in any case, with or without a hash", async () => {
		await instanceKeyring(MASTER);
		const email = `Mixed-${randomUUID()}@Example.com`;
		const out = await add(email);
		const id = out.kind === "shadow" ? out.id : "";
		const where = await contactLookup(
			"shadow_profile",
			` ${email.toUpperCase()} `,
			MASTER,
		);
		expect(where).toHaveProperty("email");
		const found = await adminDb.shadowProfile.findMany({
			where,
			select: { id: true },
		});
		expect(found.map((r) => r.id)).toEqual([id]);
	});

	it("after the epoch matches the hash: a filled row is found, an unfilled one is not, a guest is another table", async () => {
		await writeEpoch(true);
		const email = `Hashed-${randomUUID()}@Example.com`;
		const hashed = await add(email);
		const hashedId = hashed.kind === "shadow" ? hashed.id : "";
		const legacy = await adminDb.shadowProfile.create({
			data: { createdById: creator.user.id, name: "Legacy", email },
			select: { id: true },
		});
		const where = await contactLookup(
			"shadow_profile",
			email.toLowerCase(),
			MASTER,
		);
		expect(where).toEqual({
			emailHash: await expected(SHADOW, email.toLowerCase()),
		});
		const find = async () =>
			(await adminDb.shadowProfile.findMany({ where, select: { id: true } }))
				.map((r) => r.id)
				.sort();
		expect(await find()).toEqual([hashedId]);

		const ring = await instanceKeyring(MASTER);
		await fillContactHashes(keystoreDb, ring, "shadow_profile");
		expect(await find()).toEqual([hashedId, legacy.id].sort());

		const guestWhere = await contactLookup("guest_session", email, MASTER);
		expect(guestWhere).toEqual({
			emailHash: await expected(GUEST, email.toLowerCase()),
		});
	});
});

describe("responses never carry the hash", () => {
	it("people and guest procedures return no hash, with test-mode guards on", async () => {
		await instanceKeyring(MASTER);
		const people = createCallerFactory(peopleRouter)({
			session: makeSession({ id: creator.user.id, name: creator.user.name }),
			db: creator.db,
			headers: new Headers(),
		});
		const out = await people.createShadow({
			name: "Walk",
			email: `walk-${randomUUID()}@example.com`,
		});
		expect(out.participantType).toBe("shadow");
		await people.updateShadow({
			shadowId: out.participantId,
			name: "Walk 2",
			email: `walk2-${randomUUID()}@example.com`,
		});
		expect(await hashOf("shadow_profile", out.participantId)).toMatch(
			/^[0-9a-f]{16}:[0-9a-f]{64}$/,
		);
		await people.list();
		await people.search({ query: "walk" });
		await people.frequentSplitPartners();
	});
});

describe("the rollback snippet", () => {
	const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
	const NAME = "20261112200000_contact_hash";

	it("drops both columns and their indexes, twice, and the migration brings them back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const state = async (client: import("pg").Client) => {
			const columns = await client.query(`
				SELECT count(*)::int AS n FROM pg_attribute
				WHERE attrelid IN ('shadow_profile'::regclass, 'guest_session'::regclass)
				  AND NOT attisdropped AND attname = 'emailHash'`);
			const indexes = await client.query(`
				SELECT count(*)::int AS n FROM pg_indexes
				WHERE indexname IN ('shadow_profile_emailHash_idx', 'guest_session_emailHash_idx')`);
			return [columns.rows[0].n, indexes.rows[0].n];
		};
		await inRolledBackTransaction(async (client) => {
			expect(await state(client)).toEqual([2, 2]);
			await client.query(snippet);
			await client.query(snippet);
			expect(await state(client)).toEqual([0, 0]);
			await client.query(migration);
			await client.query(migration);
			expect(await state(client)).toEqual([2, 2]);
		});
	});
});
