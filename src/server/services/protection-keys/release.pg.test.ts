/**
 * releaseWraps and POST /api/v1/me/protection/keys/open on Postgres (E2EE
 * F6b-2): which wraps leave under the password proof, the digest of the one
 * that does not, the try the proof spends, and what the route refuses. Rotate
 * begin, the other caller, has its tests in rotate.pg.test.ts. Requests go
 * through the v1 handler.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { contract } from "@retrospend/api-contract";
import {
	fromBase64Url,
	fromHex,
	type Primitives,
	signInSecret,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { wrapKeyToPublic } from "@retrospend/crypto/k4";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { hashPassword } from "better-auth/crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	adminDb,
	asKey,
	call,
	expectBody,
	expectProblem,
	sessionFor,
} from "~/server/api/v1/core/__tests__/harness";
import { auth } from "~/server/better-auth";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { lockCredential } from "./password-writes";
import {
	RELEASE_READERS,
	type ReleaseReader,
	releaseWraps,
} from "./release";
import { hashRecoveryProof, type WrapRole } from "./validate";
import { stayInWindow } from "~/test/rate-window";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => true,
}));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("~/env", async (original) => {
	const actual = await original<typeof import("~/env")>();
	return {
		...actual,
		env: new Proxy(actual.env, {
			get: (target, key) =>
				key === "ADVANCED_PROTECTION_ENABLED"
					? flag.on
					: Reflect.get(target, key),
		}),
	};
});

const route = contract.protection;
const PASSWORD = "Correct horse 1";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});
beforeEach(() => {
	flag.on = true;
});
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

async function passwordUser() {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	await adminDb.user.update({
		where: { id: user.id },
		data: { emailVerified: true },
	});
	return { id: user.id };
}

type Seeded = { role: WrapRole; targetId: string; wrapped: Uint8Array };

/**
 * An account the way K1's enable leaves it (hash of the auth key, the four
 * wraps), plus wraps to a public key that no flow makes yet, which a release
 * must never show. The server opens none of them, so random keys in the right
 * shapes are enough, except where a test pins the ak-recovery bytes.
 */
async function keyed(
	userId: string,
	opts: { recoveryWrap?: Uint8Array; noRecovery?: boolean } = {},
) {
	const authKeyText = signInSecret(p.randomBytes(32));
	const symmetric = (role: "ak-password" | "ak-recovery" | "private-key") => ({
		role,
		targetId: userId,
		wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
	});
	const sealed = (role: "ak-device" | "ak-contact", targetId: string) => ({
		role,
		targetId,
		wrapped: wrapKeyToPublic(
			p,
			p.boxKeypair().publicKey,
			role,
			targetId,
			p.randomBytes(32),
		),
	});
	const collectionId = randomBytes(16).toString("hex");
	const recovery = symmetric("ak-recovery");
	const wraps: Seeded[] = [
		symmetric("ak-password"),
		...(opts.noRecovery
			? []
			: [{ ...recovery, wrapped: opts.recoveryWrap ?? recovery.wrapped }]),
		symmetric("private-key"),
		{
			role: "collection-key",
			targetId: collectionId,
			wrapped: wrapKey(
				p,
				p.randomBytes(32),
				"collection-key",
				collectionId,
				p.randomBytes(32),
			),
		},
		sealed("ak-device", "device-1"),
		sealed("ak-contact", "contact_1"),
	];
	const publicKey = p.boxKeypair().publicKey;
	await adminDb.protectionKeySet.create({
		data: {
			userId,
			kdfSalt: Uint8Array.from(p.randomBytes(16)),
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: Uint8Array.from(publicKey),
		},
	});
	await adminDb.protectionKeyWrap.createMany({
		data: wraps.map((w) => ({
			userId,
			role: w.role,
			targetId: w.targetId,
			wrapped: Uint8Array.from(w.wrapped),
		})),
	});
	await adminDb.account.updateMany({
		where: { userId, providerId: "credential" },
		data: { password: await hashPassword(authKeyText) },
	});
	return { authKeyText, wraps, publicKey };
}

let n = 0;
/** A mobile bearer with its own address and session. */
async function mobile(
	userId: string,
	extra?: { scopes?: string; clientId?: string },
) {
	const token = await sessionFor(userId, extra);
	return {
		authorization: `Bearer ${token}`,
		"x-forwarded-for": `198.51.100.${10 + (n++ % 180)}`,
	};
}

const open = (
	headers: Record<string, string>,
	authKey: string,
	idempotent = false,
) =>
	call("/me/protection/keys/open", {
		method: "POST",
		headers,
		body: { authKey },
		idempotent,
	});

type Opened = {
	version: number;
	createdAt: string;
	kdf: { salt: string; memoryKiB: number; passes: number };
	publicKey: string;
	wraps: { id: string; role: string; targetId: string; wrapped: string }[];
	recoveryWrapDigest: string | null;
};

const TRIES_WINDOW_MS = 15 * 60_000;
/** Waits until at least a minute is left in the current tries window. */
describe("POST /me/protection/keys/open", () => {
	it("gives the version, parameters, public key and the three password-opened roles, byte for byte", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const res = await open(await mobile(u.id), k.authKeyText, true);
		const got = await expectBody<Opened>(res, route.openKeys);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: u.id },
		});
		expect(got.version).toBe(1);
		expect(got.createdAt).toBe(set.createdAt.toISOString());
		expect(got.kdf).toEqual({
			salt: toBase64Url(set.kdfSalt),
			memoryKiB: 65536,
			passes: 3,
		});
		expect(got.publicKey).toBe(toBase64Url(k.publicKey));
		// Listed by hand: a role added to the answer must be added here on purpose.
		expect(got.wraps.map((w) => w.role).sort()).toEqual([
			"ak-password",
			"collection-key",
			"private-key",
		]);
		for (const w of got.wraps) {
			const stored = k.wraps.find(
				(x) => x.role === w.role && x.targetId === w.targetId,
			);
			expect(w.wrapped, w.role).toBe(
				toBase64Url(stored?.wrapped ?? new Uint8Array()),
			);
		}
		// Read-only: no stored answer, and the sign-in secret still works.
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: u.id } }),
		).toBe(0);
	});

	it("never lets ak-recovery or a public-key wrap leave, even when seeded, only the recovery digest", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const res = await open(await mobile(u.id), k.authKeyText);
		const text = await res.text();
		expect(res.status, text).toBe(200);
		for (const w of k.wraps.filter((x) =>
			["ak-recovery", "ak-device", "ak-contact"].includes(x.role),
		))
			expect(text, w.role).not.toContain(toBase64Url(w.wrapped));
		const got = JSON.parse(text) as Opened;
		expect(
			got.wraps.every((w) =>
				["ak-password", "private-key", "collection-key"].includes(w.role),
			),
		).toBe(true);
		expect(got.recoveryWrapDigest).not.toBeNull();
	});

	it("shows the BLAKE2b-256 of the stored ak-recovery wrap, as the crypto vector computes it", async () => {
		const u = await passwordUser();
		const vector = vectors.symmetricWraps.find((w) => w.role === "ak-recovery");
		if (!vector) throw new Error("the ak-recovery vector is missing");
		const k = await keyed(u.id, { recoveryWrap: fromHex(vector.wrapped) });
		const got = await expectBody<Opened>(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
		// The vector's digest comes from python hashlib, not from this code.
		expect(got.recoveryWrapDigest).toBe(toBase64Url(fromHex(vector.digest)));
		expect(fromBase64Url(got.recoveryWrapDigest ?? "")?.length).toBe(32);
	});

	it("follows the stored ak-recovery wrap: another wrap, another digest", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const first = await expectBody<Opened>(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
		const replaced = wrapKey(
			p,
			p.randomBytes(32),
			"ak-recovery",
			u.id,
			p.randomBytes(32),
		);
		await adminDb.protectionKeyWrap.updateMany({
			where: { userId: u.id, role: "ak-recovery" },
			data: { wrapped: Uint8Array.from(replaced) },
		});
		const second = await expectBody<Opened>(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
		expect(second.recoveryWrapDigest).not.toBe(first.recoveryWrapDigest);
	});

	it("answers a null digest for a set with no recovery wrap", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id, { noRecovery: true });
		const got = await expectBody<Opened>(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
		expect(got.recoveryWrapDigest).toBeNull();
	});

	it("refuses a wrong auth key with no wrap in the answer, spends a try, and stops the sixth call", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const wrong = signInSecret(p.randomBytes(32));
		for (let i = 0; i < 5; i++) {
			const res = await open(me, wrong);
			const text = await res.clone().text();
			for (const w of k.wraps)
				expect(text).not.toContain(toBase64Url(w.wrapped));
			await expectProblem(res, 400, "wrong_password");
		}
		// The wrong keys used the tries: the right one is refused now.
		const sixth = await open(me, k.authKeyText);
		await expectProblem(sixth, 429, "rate_limited");
		expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
	}, 120_000);

	it("counts a right key too: the sixth call of one session is 429", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		for (let i = 0; i < 5; i++)
			await expectBody(await open(me, k.authKeyText), route.openKeys);
		await expectProblem(await open(me, k.authKeyText), 429, "rate_limited");
	}, 120_000);

	it("shares the tries with every other password check of the account", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const u = await passwordUser();
		const k = await keyed(u.id);
		// Four other sessions each use up their own 5 per session, 20 for the account.
		for (let s = 0; s < 4; s++) {
			const other = await mobile(u.id);
			for (let i = 0; i < 5; i++)
				await expectBody(await open(other, k.authKeyText), route.openKeys);
		}
		await expectProblem(
			await open(await mobile(u.id), k.authKeyText),
			429,
			"rate_limited",
		);
	}, 180_000);

	it("is 404 for an account without keys, and spends no try", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const u = await passwordUser();
		const me = await mobile(u.id);
		for (let i = 0; i < 7; i++)
			await expectProblem(
				await open(me, signInSecret(p.randomBytes(32))),
				404,
				"not_found",
			);
	}, 120_000);

	it("is 501 when the server does not offer it, and gives no wrap or try", async () => {
		flag.on = false;
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		for (let i = 0; i < 6; i++)
			await expectProblem(
				await open(me, k.authKeyText),
				501,
				"not_implemented",
			);
		flag.on = true;
		await expectBody(await open(me, k.authKeyText), route.openKeys);
	}, 120_000);

	it("is for the person's own session: not a token, a device session or a phone without account:security", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		await expectProblem(
			await open(await asKey(u.id, ["read", "write:settings"]), k.authKeyText),
			403,
			"missing_scope",
		);
		const device = await mobile(u.id, {
			scopes: "read write:settings",
			clientId: "some-device",
		});
		await expectProblem(
			await open(device, k.authKeyText),
			403,
			"missing_scope",
		);
		const narrowed = await mobile(u.id, {
			scopes: "read write:expenses write:money",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await open(narrowed, k.authKeyText),
			403,
			"missing_scope",
		);
	});

	it("opens only the caller's own keys, not another account's", async () => {
		const a = await passwordUser();
		const b = await passwordUser();
		const ka = await keyed(a.id);
		await keyed(b.id);
		// A's sign-in secret is not B's password.
		await expectProblem(
			await open(await mobile(b.id), ka.authKeyText),
			400,
			"wrong_password",
		);
	});

	it("still works once protection is on", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		await adminDb.user.update({
			where: { id: u.id },
			data: { protectionState: "ON" },
		});
		await expectBody(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
	});

	it("refuses a sign-in secret that is not 32 bytes of canonical base64url, before any try is spent", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		expect((await open(me, `${k.authKeyText.slice(0, -1)}9`)).status).toBe(400);
		expect((await open(me, "short")).status).toBe(400);
	});

	it("answers conflict and no wrap when a writer changed the hash while it waited", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const taken = await hashPassword("a hash another writer stored");
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let locked!: () => void;
		const hasLock = new Promise<void>((r) => {
			locked = r;
		});
		const holder = adminDb.$transaction(
			async (tx) => {
				await lockCredential(tx, u.id);
				locked();
				await gate;
				await tx.account.updateMany({
					where: { userId: u.id, providerId: "credential" },
					data: { password: taken },
				});
			},
			{ timeout: 30_000 },
		);
		await hasLock;
		const pending = open(me, k.authKeyText);
		// The call waits on the credential row lock before it reads a wrap.
		const deadline = Date.now() + 15_000;
		for (;;) {
			const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
				SELECT count(*)::int AS waiting FROM pg_stat_activity
				WHERE datname = current_database() AND wait_event_type = 'Lock'`;
			if ((row?.waiting ?? 0) > 0 || Date.now() > deadline) break;
			await new Promise((r) => setTimeout(r, 25));
		}
		release();
		await holder;
		const res = await pending;
		const text = await res.clone().text();
		for (const w of k.wraps) expect(text).not.toContain(toBase64Url(w.wrapped));
		await expectProblem(res, 409, "conflict");
	}, 60_000);
});

describe("rotate begin, the other caller of releaseWraps", () => {
	it("answers the same ak-password bytes as keys/open and never another role", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const opened = await expectBody<Opened>(
			await open(await mobile(u.id), k.authKeyText),
			route.openKeys,
		);
		const begun = await expectBody<{ wrappedAccountKey: string }>(
			await call("/me/protection/password/begin", {
				method: "POST",
				headers: await mobile(u.id),
				body: { currentAuthKey: k.authKeyText },
			}),
			route.beginPasswordRotation,
		);
		expect(begun.wrappedAccountKey).toBe(
			opened.wraps.find((w) => w.role === "ak-password")?.wrapped,
		);
		const text = JSON.stringify(begun);
		for (const w of k.wraps.filter((x) => x.role !== "ak-password"))
			expect(text).not.toContain(toBase64Url(w.wrapped));
	});
});

describe("releaseWraps", () => {
	it("computes the recovery digest only for the reader that shows it", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const proof = { authKey: k.authKeyText, sessionId: "s1" } as const;
		const rotate = await releaseWraps(u.id, { reader: "rotateBegin", ...proof });
		expect(rotate.recoveryWrapDigest).toBeNull();
		const shown = await releaseWraps(u.id, { reader: "keysOpen", ...proof });
		expect(shown.recoveryWrapDigest?.length).toBe(32);
	});
});

/**
 * Where each reader is driven through its own caller, one case per member of
 * the union (a `Record`, so a reader added without a case fails typecheck).
 */
const READER_DRIVEN_BY: Record<ReleaseReader, { file: string }> = {
	rotateBegin: { file: "src/server/services/protection-keys/rotate.pg.test.ts" },
	keysOpen: { file: "src/server/services/protection-keys/release.pg.test.ts" },
	recoveryBegin: { file: "src/server/services/protection-keys/recover.pg.test.ts" },
};

/** The roles each reader gets, written out by hand from the plan (not read from release.ts). */
const ROLES_BY_READER: Record<ReleaseReader, string[]> = {
	rotateBegin: ["ak-password"],
	keysOpen: ["ak-password", "collection-key", "private-key"],
	recoveryBegin: ["ak-recovery", "private-key"],
};

describe("the reader union", () => {
	it("is the plan's reader table, and every member has a test that drives it", () => {
		const plan = ["rotateBegin", "keysOpen", "recoveryBegin"];
		expect([...RELEASE_READERS].sort()).toEqual([...plan].sort());
		expect(Object.keys(READER_DRIVEN_BY).sort()).toEqual([...plan].sort());
		expect(Object.keys(ROLES_BY_READER).sort()).toEqual([...plan].sort());
		for (const driven of Object.values(READER_DRIVEN_BY))
			expect(existsSync(join(REPO_ROOT, driven.file)), driven.file).toBe(true);
	});

	it.each(RELEASE_READERS)(
		"%s gets its roles and no wrap of another role, even when all six are stored",
		async (reader) => {
			const u = await passwordUser();
			const k = await keyed(u.id);
			const recoveryAuthKey = signInSecret(p.randomBytes(32));
			await adminDb.protectionKeySet.update({
				where: { userId: u.id },
				data: { recoveryHash: Uint8Array.from(hashRecoveryProof(recoveryAuthKey)) },
			});
			const released =
				reader === "recoveryBegin"
					? await releaseWraps(u.id, {
							reader,
							recoveryAuthKey,
							tokenHash: randomBytes(32).toString("hex"),
						})
					: await releaseWraps(u.id, {
							reader,
							authKey: k.authKeyText,
							sessionId: randomUUID(),
						});
			expect(released.wraps.map((w) => w.role).sort()).toEqual(
				ROLES_BY_READER[reader],
			);
			const text = JSON.stringify(released.wraps.map((w) => toBase64Url(w.wrapped)));
			for (const w of k.wraps.filter((x) => !ROLES_BY_READER[reader].includes(x.role)))
				expect(text, w.role).not.toContain(toBase64Url(w.wrapped));
			// Only keys/open shows the digest of the recovery wrap.
			expect(released.recoveryWrapDigest !== null).toBe(reader === "keysOpen");
		},
	);
});
