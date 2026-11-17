/**
 * POST /api/v1/me/protection/password/begin and /me/protection/password on
 * Postgres (E2EE K2-1): what changing the password of a keyed account writes,
 * what it refuses, that it is all or nothing, and that it takes turns with the
 * other password writers. Requests go through the v1 handler, the sign-in
 * checks through better-auth.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import {
	type Primitives,
	signInSecret,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { hashPassword, verifyPassword } from "better-auth/crypto";
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
import { lockCredential } from "./password-writes";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("~/server/mailer", () => mail);
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
const MIN = 60_000;

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});
beforeEach(() => {
	flag.on = true;
	mail.sendEmail.mockClear();
});
// The rollback test of the key tables needs them empty, and a worker's database
// outlives the file: leave no key rows behind.
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

async function passwordUser() {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	await adminDb.user.update({
		where: { id: user.id },
		data: { emailVerified: true },
	});
	mail.sendEmail.mockClear(); // sign-up sent its own verification mail
	return { id: user.id, email };
}

/**
 * An account the way K1's enable leaves it: the stored hash is of the auth key,
 * and the key set holds the four wraps. The server opens none of them, so
 * random keys in the right wrap shapes are enough.
 */
async function keyed(userId: string, opts: { state?: "OFF" | "ON" } = {}) {
	const authKeyText = signInSecret(p.randomBytes(32));
	const salt = p.randomBytes(16);
	const wrapOf = (role: "ak-password" | "ak-recovery" | "private-key") => ({
		role,
		targetId: userId,
		wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
	});
	const collectionId = `ck-${randomBytes(6).toString("hex")}`;
	const wraps = [
		wrapOf("ak-password"),
		wrapOf("ak-recovery"),
		wrapOf("private-key"),
		{
			role: "collection-key" as const,
			targetId: collectionId,
			wrapped: wrapKey(
				p,
				p.randomBytes(32),
				"collection-key",
				collectionId,
				p.randomBytes(32),
			),
		},
	];
	const publicKey = p.boxKeypair().publicKey;
	await adminDb.protectionKeySet.create({
		data: {
			userId,
			kdfSalt: Uint8Array.from(salt),
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
	if (opts.state === "ON")
		await adminDb.user.update({
			where: { id: userId },
			data: { protectionState: "ON" },
		});
	return { authKeyText, salt, wraps, publicKey };
}

/** What a device sends after it derived with the new password and rewrapped. */
function rotationOf(userId: string, current: string, baseVersion = 1) {
	const newAuthKey = signInSecret(p.randomBytes(32));
	const salt = p.randomBytes(16);
	const wrapped = wrapKey(
		p,
		p.randomBytes(32),
		"ak-password",
		userId,
		p.randomBytes(32),
	);
	return {
		newAuthKey,
		salt,
		wrapped,
		body: {
			currentAuthKey: current,
			newAuthKey,
			kdf: { salt: toBase64Url(salt), memoryKiB: 65536, passes: 3 },
			wrappedAccountKey: toBase64Url(wrapped),
			baseVersion,
		},
	};
}

let n = 0;
/** A mobile bearer, its headers and the id of its session, each with its own address. */
async function mobile(
	userId: string,
	extra?: { scopes?: string; clientId?: string },
) {
	const token = await sessionFor(userId, extra);
	const row = await adminDb.session.findUniqueOrThrow({ where: { token } });
	return {
		id: row.id,
		token,
		headers: {
			authorization: `Bearer ${token}`,
			"x-forwarded-for": `198.51.100.${10 + (n++ % 180)}`,
		},
	};
}

type Headers = Record<string, string>;
const begin = (headers: Headers, currentAuthKey: string, idempotent = false) =>
	call("/me/protection/password/begin", {
		method: "POST",
		headers,
		body: { currentAuthKey },
		idempotent,
	});
const rotate = (
	headers: Headers,
	body: unknown,
	idempotent: boolean | string = true,
) =>
	call("/me/protection/password", {
		method: "POST",
		headers,
		body,
		idempotent,
	});

const storedHash = async (userId: string) =>
	(
		await adminDb.account.findFirstOrThrow({
			where: { userId, providerId: "credential" },
		})
	).password ?? "";
const wrapRows = (userId: string) =>
	adminDb.protectionKeyWrap.findMany({
		where: { userId },
		orderBy: [{ role: "asc" }, { targetId: "asc" }],
	});
const setRow = (userId: string) =>
	adminDb.protectionKeySet.findUniqueOrThrow({ where: { userId } });
const keyRows = async (userId: string) => ({
	sets: await adminDb.protectionKeySet.count({ where: { userId } }),
	wraps: await adminDb.protectionKeyWrap.count({ where: { userId } }),
});
const sessionExists = async (token: string) =>
	(await adminDb.session.findUnique({ where: { token } })) !== null;
const resetToken = (email: string) =>
	adminDb.passwordResetToken.create({
		data: {
			identifier: email,
			token: randomBytes(16).toString("hex"),
			expires: new Date(Date.now() + 60 * MIN),
		},
	});
const signsInWith = (email: string, password: string) =>
	auth.api
		.signInEmail({ body: { email, password } })
		.then(() => true)
		.catch(() => false);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const TRIES_WINDOW_MS = 15 * 60_000;
/** Waits until at least a minute is left in the current tries window. */
async function clearTriesWindowEdge(): Promise<void> {
	const left = TRIES_WINDOW_MS - (Date.now() % TRIES_WINDOW_MS);
	if (left < 60_000) await new Promise((r) => setTimeout(r, left + 1_000));
}

/** Holds the credential lock in its own owner transaction until `commit`. */
async function holdCredentialLock(
	userId: string,
	whileHeld: (tx: Parameters<typeof lockCredential>[0]) => Promise<void>,
) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let locked!: () => void;
	const hasLock = new Promise<void>((resolve) => {
		locked = resolve;
	});
	const open = adminDb.$transaction(
		async (tx) => {
			await lockCredential(tx, userId);
			locked();
			await gate;
			await whileHeld(tx);
		},
		{ timeout: 30_000 },
	);
	await hasLock;
	return {
		commit: async () => {
			release();
			await open;
		},
	};
}

/**
 * Waits until a call is blocked on a row lock (Postgres says so in
 * pg_stat_activity), so the holder commits only once the call really waits.
 */
async function blockedBehindLock(pending: Promise<Response>) {
	let done = false;
	void pending.then(
		() => {
			done = true;
		},
		() => {
			done = true;
		},
	);
	const deadline = Date.now() + 15_000;
	while (!done && Date.now() < deadline) {
		const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
			SELECT count(*)::int AS waiting FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'`;
		if ((row?.waiting ?? 0) > 0) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return false;
}

type Begun = {
	version: number;
	kdf: { salt: string; memoryKiB: number; passes: number };
	wrappedAccountKey: string;
};

describe("POST /me/protection/password/begin", () => {
	it("gives the wrap, version and parameters for the right auth key, and stores nothing of the answer", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		// Even with an Idempotency-Key sent, no response is kept.
		const res = await begin(me.headers, k.authKeyText, true);
		const got = await expectBody<Begun>(res, route.beginPasswordRotation);
		const stored = (await wrapRows(u.id)).find((w) => w.role === "ak-password");
		expect(got).toEqual({
			version: 1,
			kdf: { salt: toBase64Url(k.salt), memoryKiB: 65536, passes: 3 },
			wrappedAccountKey: toBase64Url(stored?.wrapped ?? new Uint8Array()),
		});
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: u.id } }),
		).toBe(0);
		// Only the password wrap leaves: no other wrap and no public key.
		const text = JSON.stringify(got);
		for (const w of k.wraps.filter((x) => x.role !== "ak-password"))
			expect(text).not.toContain(toBase64Url(w.wrapped));
		expect(text).not.toContain(toBase64Url(k.publicKey));
		// It changed nothing.
		expect(await signsInWith(u.email, k.authKeyText)).toBe(true);
		expect((await setRow(u.id)).version).toBe(1);
	});

	it("refuses a wrong auth key with no wrap in the answer, and counts a try, up to the limit", async () => {
		await clearTriesWindowEdge();
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const wrong = signInSecret(p.randomBytes(32));
		for (let i = 0; i < 5; i++) {
			const res = await begin(me.headers, wrong);
			const text = await res.clone().text();
			expect(text).not.toContain(
				toBase64Url(
					(await wrapRows(u.id)).find((w) => w.role === "ak-password")
						?.wrapped ?? new Uint8Array(),
				),
			);
			await expectProblem(res, 400, "wrong_password");
		}
		// The sixth try is refused even with the right key.
		const res = await begin(me.headers, k.authKeyText);
		await expectProblem(res, 429, "rate_limited");
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
	}, 120_000);

	it("is a conflict for an account without keys, and spends no try", async () => {
		await clearTriesWindowEdge();
		const u = await passwordUser();
		const me = await mobile(u.id);
		for (let i = 0; i < 6; i++)
			await expectProblem(
				await begin(me.headers, signInSecret(p.randomBytes(32))),
				409,
				"conflict",
			);
	}, 120_000);

	it("is refused with 501 when the server does not offer it, and gives no wrap", async () => {
		flag.on = false;
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		await expectProblem(
			await begin(me.headers, k.authKeyText),
			501,
			"not_implemented",
		);
	});

	it("is for the person's own session: not a token, a device session or a phone without account:security", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		await expectProblem(
			await begin(await asKey(u.id, ["read", "write:settings"]), k.authKeyText),
			403,
			"missing_scope",
		);
		const device = await mobile(u.id, {
			scopes: "read write:settings",
			clientId: "some-device",
		});
		await expectProblem(
			await begin(device.headers, k.authKeyText),
			403,
			"missing_scope",
		);
		const narrowed = await mobile(u.id, {
			scopes: "read write:expenses write:money",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await begin(narrowed.headers, k.authKeyText),
			403,
			"missing_scope",
		);
	});

	it("works for a phone narrowed to write:settings, which has no vault scope", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const phone = await mobile(u.id, {
			scopes: "write:settings",
			clientId: "retrospend-mobile",
		});
		await expectBody(
			await begin(phone.headers, k.authKeyText),
			route.beginPasswordRotation,
		);
	});

	it("still works once protection is on", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id, { state: "ON" });
		const me = await mobile(u.id);
		await expectBody(
			await begin(me.headers, k.authKeyText),
			route.beginPasswordRotation,
		);
	});

	it("refuses a sign-in secret that is not 32 bytes of canonical base64url, before any try is spent", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const loose = `${k.authKeyText.slice(0, -1)}9`;
		expect((await begin(me.headers, loose)).status).toBe(400);
		expect((await begin(me.headers, "short")).status).toBe(400);
	});

	describe("when a writer lands between the proof and the read", () => {
		/** Begin while another writer holds the credential lock, then the writer commits. */
		async function beginBehind(
			userId: string,
			authKey: string,
			writer: Parameters<typeof holdCredentialLock>[1],
		) {
			const me = await mobile(userId);
			const holder = await holdCredentialLock(userId, writer);
			const pending = begin(me.headers, authKey);
			expect(await blockedBehindLock(pending)).toBe(true);
			await holder.commit();
			return pending;
		}
		const noWrap = async (res: Response, userId: string) => {
			const text = await res.text();
			for (const w of await wrapRows(userId))
				expect(text).not.toContain(toBase64Url(w.wrapped));
		};

		it("answers conflict and no wrap when only the hash changed", async () => {
			const u = await passwordUser();
			const k = await keyed(u.id);
			const taken = await hashPassword("a hash another writer stored");
			const res = await beginBehind(u.id, k.authKeyText, async (tx) => {
				await tx.account.updateMany({
					where: { userId: u.id, providerId: "credential" },
					data: { password: taken },
				});
			});
			await noWrap(res.clone(), u.id);
			await expectProblem(res, 409, "conflict");
		});

		it("answers conflict and no wrap when an email reset removed the keys and replaced the hash", async () => {
			const u = await passwordUser();
			const k = await keyed(u.id);
			const wraps = await wrapRows(u.id);
			const reset = await hashPassword("A reset password 3");
			const res = await beginBehind(u.id, k.authKeyText, async (tx) => {
				await tx.protectionKeyWrap.deleteMany({ where: { userId: u.id } });
				await tx.protectionKeySet.deleteMany({ where: { userId: u.id } });
				await tx.account.updateMany({
					where: { userId: u.id, providerId: "credential" },
					data: { password: reset },
				});
			});
			const text = await res.clone().text();
			for (const w of wraps) expect(text).not.toContain(toBase64Url(w.wrapped));
			await expectProblem(res, 409, "conflict");
		});

		it("answers conflict and no wrap when the keys are gone and the hash is the one proven", async () => {
			const u = await passwordUser();
			const k = await keyed(u.id);
			const wraps = await wrapRows(u.id);
			const res = await beginBehind(u.id, k.authKeyText, async (tx) => {
				await tx.protectionKeyWrap.deleteMany({ where: { userId: u.id } });
				await tx.protectionKeySet.deleteMany({ where: { userId: u.id } });
			});
			const text = await res.clone().text();
			for (const w of wraps) expect(text).not.toContain(toBase64Url(w.wrapped));
			await expectProblem(res, 409, "conflict");
		});
	});
});

describe("POST /me/protection/password", () => {
	it("swaps the hash, salt and wrap, bumps the version, ends other sessions and reset links, records and mails", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const web = await sessionFor(u.id, {});
		await resetToken(u.email);
		const before = await wrapRows(u.id);
		const oldWrap = before.find((w) => w.role === "ak-password");
		const set = await setRow(u.id);
		const r = rotationOf(u.id, k.authKeyText);

		const done = await expectBody<{ version: number; signedOut: number }>(
			await rotate(me.headers, r.body),
			route.rotatePassword,
		);
		// The sign-up session, the other mobile one and the web one.
		expect(done).toEqual({ version: 2, signedOut: 3 });

		// The new auth key signs in and the old one does not.
		expect(await signsInWith(u.email, r.newAuthKey)).toBe(true);
		expect(await signsInWith(u.email, k.authKeyText)).toBe(false);
		expect(
			await verifyPassword({
				password: r.newAuthKey,
				hash: await storedHash(u.id),
			}),
		).toBe(true);

		const after = await setRow(u.id);
		expect(hex(after.kdfSalt)).toBe(hex(r.salt));
		expect([after.kdfMemoryKiB, after.kdfPasses, after.version]).toEqual([
			65536, 3, 2,
		]);
		// The account public key and the creation time do not move.
		expect(hex(after.publicKey)).toBe(hex(set.publicKey));
		expect(after.createdAt.toISOString()).toBe(set.createdAt.toISOString());

		const rows = await wrapRows(u.id);
		const passwordWraps = rows.filter((w) => w.role === "ak-password");
		expect(passwordWraps).toHaveLength(1);
		expect(hex(passwordWraps[0]?.wrapped ?? new Uint8Array())).toBe(
			hex(r.wrapped),
		);
		// The old wrap row is gone, not kept: it would still open the account key.
		expect(passwordWraps[0]?.id).not.toBe(oldWrap?.id);
		expect(rows.some((w) => w.id === oldWrap?.id)).toBe(false);
		// Every other wrap is byte for byte what it was.
		for (const w of before.filter((x) => x.role !== "ak-password")) {
			const now = rows.find((x) => x.id === w.id);
			expect(hex(now?.wrapped ?? new Uint8Array())).toBe(hex(w.wrapped));
		}
		expect(rows).toHaveLength(4);
		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: u.id } }))
				.protectionState,
		).toBe("OFF");

		expect(await sessionExists(me.token)).toBe(true);
		expect(await sessionExists(other)).toBe(false);
		expect(await sessionExists(web)).toBe(false);
		expect(
			await adminDb.passwordResetToken.count({
				where: { identifier: u.email },
			}),
		).toBe(0);

		const audit = await adminDb.eventLog.findMany({
			where: { userId: u.id, eventType: "PASSWORD_CHANGED" },
		});
		expect(audit).toHaveLength(1);
		expect(audit[0]?.metadata).toEqual({ reason: "protection_keys_rotated" });
		expect(JSON.stringify(audit[0])).not.toContain(u.email);
		expect(
			await adminDb.apiEvent.count({
				where: { actorUserId: u.id, type: "user.password_changed" },
			}),
		).toBe(1);

		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		const [to, subject, html] = mail.sendEmail.mock.calls[0] as unknown as [
			string,
			string,
			string,
		];
		expect(to).toBe(u.email);
		expect(subject).toBe("Your password was changed");
		for (const secret of [r.newAuthKey, k.authKeyText, PASSWORD, "Lucía", u.id])
			expect(html).not.toContain(secret);
	});

	it("works end to end after begin, and leaves the plain password routes refusing the account", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const begun = await expectBody<Begun>(
			await begin(me.headers, k.authKeyText),
			route.beginPasswordRotation,
		);
		const r = rotationOf(u.id, k.authKeyText, begun.version);
		await expectBody(await rotate(me.headers, r.body), route.rotatePassword);
		// The keyed account still cannot use the plain route, with either secret.
		for (const currentPassword of [r.newAuthKey, PASSWORD])
			await expectProblem(
				await call("/me/password", {
					method: "POST",
					headers: me.headers,
					body: { currentPassword, newPassword: "Battery staple 2" },
					idempotent: true,
				}),
				403,
				"protected_password",
			);
		expect(await signsInWith(u.email, r.newAuthKey)).toBe(true);
	});

	it("still works once protection is on", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id, { state: "ON" });
		const me = await mobile(u.id);
		const r = rotationOf(u.id, k.authKeyText);
		await expectBody(await rotate(me.headers, r.body), route.rotatePassword);
		expect(await signsInWith(u.email, r.newAuthKey)).toBe(true);
	});

	it("counts a wrong current key as a try and changes nothing, then stops at the limit", async () => {
		await clearTriesWindowEdge();
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const hash = await storedHash(u.id);
		const before = await wrapRows(u.id);
		const r = rotationOf(u.id, signInSecret(p.randomBytes(32)));
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await rotate(me.headers, r.body),
				400,
				"wrong_password",
			);
		expect(await storedHash(u.id)).toBe(hash);
		expect((await wrapRows(u.id)).map((w) => w.id)).toEqual(
			before.map((w) => w.id),
		);
		expect((await setRow(u.id)).version).toBe(1);
		expect(await sessionExists(other)).toBe(true);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		// The sixth is refused even with the right key.
		const res = await rotate(me.headers, rotationOf(u.id, k.authKeyText).body);
		await expectProblem(res, 429, "rate_limited");
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(await storedHash(u.id)).toBe(hash);
	}, 120_000);

	it("leaves a session room for begin, commit, a retry's begin and commit, and one more call", async () => {
		await clearTriesWindowEdge();
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		await expectBody(
			await begin(me.headers, k.authKeyText),
			route.beginPasswordRotation,
		);
		// Stale: the first commit conflicts, so the client starts again.
		await expectProblem(
			await rotate(me.headers, rotationOf(u.id, k.authKeyText, 7).body),
			409,
			"conflict",
		);
		const begun = await expectBody<Begun>(
			await begin(me.headers, k.authKeyText),
			route.beginPasswordRotation,
		);
		await expectBody(
			await rotate(
				me.headers,
				rotationOf(u.id, k.authKeyText, begun.version).body,
			),
			route.rotatePassword,
		);
		// Four calls, each one a try; the fifth still passes and the sixth does not.
		await expectProblem(
			await begin(me.headers, signInSecret(p.randomBytes(32))),
			400,
			"wrong_password",
		);
		await expectProblem(
			await begin(me.headers, signInSecret(p.randomBytes(32))),
			429,
			"rate_limited",
		);
	}, 120_000);

	it("answers conflict for a stale baseVersion and changes nothing", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const hash = await storedHash(u.id);
		const before = await wrapRows(u.id);
		await expectProblem(
			await rotate(me.headers, rotationOf(u.id, k.authKeyText, 2).body),
			409,
			"conflict",
		);
		expect(await storedHash(u.id)).toBe(hash);
		expect(await signsInWith(u.email, k.authKeyText)).toBe(true);
		const after = await wrapRows(u.id);
		expect(after.map((w) => `${w.id}|${hex(w.wrapped)}`)).toEqual(
			before.map((w) => `${w.id}|${hex(w.wrapped)}`),
		);
		expect((await setRow(u.id)).version).toBe(1);
		expect(hex((await setRow(u.id)).kdfSalt)).toBe(hex(k.salt));
		expect(await sessionExists(other)).toBe(true);
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("answers conflict, not wrong password, for the old key after another rotation", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const r = rotationOf(u.id, k.authKeyText);
		await expectBody(await rotate(me.headers, r.body), route.rotatePassword);
		// A client that still holds the old key and version (the rotation ended
		// every other session, so the retry comes from the one that made it).
		await expectProblem(
			await rotate(me.headers, rotationOf(u.id, k.authKeyText).body),
			409,
			"conflict",
		);
		expect(await signsInWith(u.email, r.newAuthKey)).toBe(true);
	});

	it("answers conflict for an account without keys and leaves its password alone", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const hash = await storedHash(u.id);
		await expectProblem(
			await rotate(
				me.headers,
				rotationOf(u.id, signInSecret(p.randomBytes(32))).body,
			),
			409,
			"conflict",
		);
		expect(await storedHash(u.id)).toBe(hash);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		expect(await signsInWith(u.email, PASSWORD)).toBe(true);
	});

	it("answers conflict for every commit of an account without keys, and spends no try", async () => {
		await clearTriesWindowEdge();
		const u = await passwordUser();
		const me = await mobile(u.id);
		const r = rotationOf(u.id, signInSecret(p.randomBytes(32)));
		for (let i = 0; i < 6; i++)
			await expectProblem(await rotate(me.headers, r.body), 409, "conflict");
	}, 120_000);

	it("is refused with 501 when the server does not offer it, and writes nothing", async () => {
		flag.on = false;
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const hash = await storedHash(u.id);
		await expectProblem(
			await rotate(me.headers, rotationOf(u.id, k.authKeyText).body),
			501,
			"not_implemented",
		);
		expect(await storedHash(u.id)).toBe(hash);
		expect((await setRow(u.id)).version).toBe(1);
	});

	it("is for the person's own session: not a token, a device session or a phone without account:security", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const body = rotationOf(u.id, k.authKeyText).body;
		await expectProblem(
			await rotate(await asKey(u.id, ["read", "write:settings"]), body),
			403,
			"missing_scope",
		);
		const device = await mobile(u.id, {
			scopes: "read write:settings",
			clientId: "some-device",
		});
		await expectProblem(
			await rotate(device.headers, body),
			403,
			"missing_scope",
		);
		const narrowed = await mobile(u.id, {
			scopes: "read write:expenses write:money",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await rotate(narrowed.headers, body),
			403,
			"missing_scope",
		);
		expect((await setRow(u.id)).version).toBe(1);
	});

	it("refuses a malformed request before any try is spent", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const r = rotationOf(u.id, k.authKeyText);
		const loose = `${r.newAuthKey.slice(0, -1)}9`;
		expect(
			(await rotate(me.headers, { ...r.body, newAuthKey: loose })).status,
		).toBe(400);
		// A wrap of the wrong length.
		expect(
			(
				await rotate(me.headers, {
					...r.body,
					wrappedAccountKey: toBase64Url(r.wrapped.slice(0, 60)),
				})
			).status,
		).toBe(400);
		// Parameters under the floor.
		expect(
			(
				await rotate(me.headers, {
					...r.body,
					kdf: { ...r.body.kdf, memoryKiB: 1024 },
				})
			).status,
		).toBe(400);
		expect(
			(await rotate(me.headers, { ...r.body, baseVersion: 0 })).status,
		).toBe(400);
		expect((await setRow(u.id)).version).toBe(1);
		expect(await signsInWith(u.email, k.authKeyText)).toBe(true);
	});

	it("replays the first answer for the same key without writing again", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const r = rotationOf(u.id, k.authKeyText);
		const key = randomUUID();
		const first = await expectBody(
			await rotate(me.headers, r.body, key),
			route.rotatePassword,
		);
		const hash = await storedHash(u.id);
		const second = await rotate(me.headers, r.body, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await expectBody(second, route.rotatePassword)).toEqual(first);
		expect(await storedHash(u.id)).toBe(hash);
		expect((await setRow(u.id)).version).toBe(2);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(
			await adminDb.eventLog.count({
				where: { userId: u.id, eventType: "PASSWORD_CHANGED" },
			}),
		).toBe(1);
	});

	it("binds the wrapped account key into the request, so a reused Idempotency-Key with another wrap is refused", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const r = rotationOf(u.id, k.authKeyText);
		const key = randomUUID();
		await expectBody(
			await rotate(me.headers, r.body, key),
			route.rotatePassword,
		);
		const other = rotationOf(u.id, k.authKeyText);
		await expectProblem(
			await rotate(
				me.headers,
				{ ...r.body, wrappedAccountKey: other.body.wrappedAccountKey },
				key,
			),
			422,
			"idempotency_key_reused",
		);
		expect((await setRow(u.id)).version).toBe(2);
	});

	it("is all or nothing when the database fails after the hash swap", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const token = await resetToken(u.email);
		const hash = await storedHash(u.id);
		const before = await wrapRows(u.id);
		// The audit insert is the last write: the hash, the set, the wrap and the
		// session delete have all happened when it fails.
		const guard = `rotate_fail_${randomBytes(4).toString("hex")}`;
		await adminDb.$executeRawUnsafe(`
			CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN RAISE EXCEPTION 'rotation test failure'; END $$`);
		await adminDb.$executeRawUnsafe(`
			CREATE TRIGGER ${guard} BEFORE INSERT ON "event_log"
			FOR EACH ROW WHEN (NEW."userId" = '${u.id}') EXECUTE FUNCTION ${guard}()`);
		try {
			const res = await rotate(
				me.headers,
				rotationOf(u.id, k.authKeyText).body,
			);
			expect(res.status).toBe(500);
		} finally {
			await adminDb.$executeRawUnsafe(
				`DROP TRIGGER IF EXISTS ${guard} ON "event_log"`,
			);
			await adminDb.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${guard}()`);
		}
		expect(await storedHash(u.id)).toBe(hash);
		expect(await signsInWith(u.email, k.authKeyText)).toBe(true);
		const set = await setRow(u.id);
		expect([set.version, hex(set.kdfSalt)]).toEqual([1, hex(k.salt)]);
		const after = await wrapRows(u.id);
		expect(after.map((w) => `${w.id}|${hex(w.wrapped)}`)).toEqual(
			before.map((w) => `${w.id}|${hex(w.wrapped)}`),
		);
		expect(await sessionExists(other)).toBe(true);
		expect(
			await adminDb.passwordResetToken.count({ where: { token: token.token } }),
		).toBe(1);
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("takes the hash it checked, not whatever is stored when the lock is free", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const before = await wrapRows(u.id);
		const taken = await hashPassword("a hash another writer stored");
		// Another writer holds the credential lock and changes only the hash; the
		// key set and its version stay as they were.
		const holder = await holdCredentialLock(u.id, async (tx) => {
			await tx.account.updateMany({
				where: { userId: u.id, providerId: "credential" },
				data: { password: taken },
			});
		});
		const pending = rotate(me.headers, rotationOf(u.id, k.authKeyText).body);
		expect(await blockedBehindLock(pending)).toBe(true);
		await holder.commit();
		await expectProblem(await pending, 409, "conflict");
		expect(await storedHash(u.id)).toBe(taken);
		expect((await setRow(u.id)).version).toBe(1);
		expect(
			(await wrapRows(u.id)).map((w) => `${w.id}|${hex(w.wrapped)}`),
		).toEqual(before.map((w) => `${w.id}|${hex(w.wrapped)}`));
		expect(await sessionExists(other)).toBe(true);
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("answers conflict when an email reset removed the keys and replaced the hash while it waited, and leaves no key set", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const reset = await hashPassword("A reset password 3");
		// The reset (allowed while OFF) holds the lock, removes the keys and writes
		// a plain hash. The rotation checked the old key before it, so its
		// verify passes and only the transaction can see what changed.
		const holder = await holdCredentialLock(u.id, async (tx) => {
			await tx.protectionKeyWrap.deleteMany({ where: { userId: u.id } });
			await tx.protectionKeySet.deleteMany({ where: { userId: u.id } });
			await tx.account.updateMany({
				where: { userId: u.id, providerId: "credential" },
				data: { password: reset },
			});
		});
		const pending = rotate(me.headers, rotationOf(u.id, k.authKeyText).body);
		expect(await blockedBehindLock(pending)).toBe(true);
		await holder.commit();
		await expectProblem(await pending, 409, "conflict");
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		expect(await storedHash(u.id)).toBe(reset);
		expect(await signsInWith(u.email, "A reset password 3")).toBe(true);
		expect(await sessionExists(other)).toBe(true);
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("answers conflict, with the hash untouched, when the keys are removed under it and the hash is the one checked", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const hash = await storedHash(u.id);
		const holder = await holdCredentialLock(u.id, async (tx) => {
			await tx.protectionKeyWrap.deleteMany({ where: { userId: u.id } });
			await tx.protectionKeySet.deleteMany({ where: { userId: u.id } });
		});
		const pending = rotate(me.headers, rotationOf(u.id, k.authKeyText).body);
		expect(await blockedBehindLock(pending)).toBe(true);
		await holder.commit();
		await expectProblem(await pending, 409, "conflict");
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		expect(await storedHash(u.id)).toBe(hash);
		expect(await sessionExists(other)).toBe(true);
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("lets exactly one of two rotations from the same state win", async () => {
		const u = await passwordUser();
		const k = await keyed(u.id);
		const a = await mobile(u.id);
		const b = await mobile(u.id);
		const ra = rotationOf(u.id, k.authKeyText);
		const rb = rotationOf(u.id, k.authKeyText);
		const [x, y] = await Promise.all([
			rotate(a.headers, ra.body),
			rotate(b.headers, rb.body),
		]);
		expect([x.status, y.status].sort()).toEqual([200, 409]);
		const winner = x.status === 200 ? ra : rb;
		const loser = x.status === 200 ? rb : ra;
		expect(
			await verifyPassword({
				password: winner.newAuthKey,
				hash: await storedHash(u.id),
			}),
		).toBe(true);
		expect(
			await verifyPassword({
				password: loser.newAuthKey,
				hash: await storedHash(u.id),
			}),
		).toBe(false);
		const set = await setRow(u.id);
		expect([set.version, hex(set.kdfSalt)]).toEqual([2, hex(winner.salt)]);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
	});
});
