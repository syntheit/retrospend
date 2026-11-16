/**
 * POST /api/v1/me/protection/enable and GET /me/protection/keys on Postgres
 * (E2EE K1-2): what turning on Advanced protection keys writes, what it
 * refuses, that it is all or nothing, and that two sessions cannot both win.
 * Requests go through the v1 handler, the sign-in checks through better-auth.
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
import { symmetricEncrypt, verifyPassword } from "better-auth/crypto";
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
import { verifyTwoFactorCode } from "./two-factor";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("~/server/mailer", () => mail);
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => true,
}));
// The flag is read once at start-up in production; the test flips it.
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

async function passwordUser(opts: { verified?: boolean } = {}) {
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
		data: { emailVerified: opts.verified ?? true },
	});
	mail.sendEmail.mockClear(); // sign-up sent its own verification mail
	return { id: user.id, email };
}

/** A mobile bearer, its headers and the id of its session, each with its own address. */
let n = 0;
async function mobile(userId: string) {
	const token = await sessionFor(userId);
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

type Made = ReturnType<typeof made>;
/** A key set a device could make: only the shapes matter, the server opens nothing. */
function made(userId: string, overrides: { authKey?: Uint8Array } = {}) {
	const authKey = overrides.authKey ?? p.randomBytes(32);
	const wrap = (role: "ak-password" | "ak-recovery" | "private-key") => ({
		role,
		targetId: userId,
		wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
	});
	const collectionId = `ck-${randomBytes(6).toString("hex")}`;
	const wraps = [
		wrap("ak-password"),
		wrap("ak-recovery"),
		wrap("private-key"),
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
	return {
		authKeyText: signInSecret(authKey),
		salt: p.randomBytes(16),
		publicKey: p.boxKeypair().publicKey,
		wraps,
	};
}
function bodyOf(
	m: Made,
	extra: { currentPassword?: string; totpCode?: string } = {},
) {
	return {
		currentPassword: extra.currentPassword ?? PASSWORD,
		authKey: m.authKeyText,
		...(extra.totpCode && { totpCode: extra.totpCode }),
		kdf: { salt: toBase64Url(m.salt), memoryKiB: 65536, passes: 3 },
		publicKey: toBase64Url(m.publicKey),
		wraps: m.wraps.map((w) => ({
			role: w.role,
			targetId: w.targetId,
			wrapped: toBase64Url(w.wrapped),
		})),
	};
}

const enable = (
	headers: Record<string, string>,
	body: unknown,
	idempotent: boolean | string = true,
) =>
	call("/me/protection/enable", {
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

describe("POST /me/protection/enable", () => {
	it("writes the new hash, the set and its wraps, ends the other sessions, removes reset links, records and mails", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const web = await sessionFor(u.id, {});
		await resetToken(u.email);
		const m = made(u.id);

		const done = await expectBody<{
			version: number;
			createdAt: string;
			signedOut: number;
		}>(await enable(me.headers, bodyOf(m)), route.enable);
		// The sign-up session, the other mobile one and the web one.
		expect(done).toMatchObject({ version: 1, signedOut: 3 });

		// The password is now the auth key: the old typed one no longer signs in.
		expect(await signsInWith(u.email, PASSWORD)).toBe(false);
		expect(await signsInWith(u.email, m.authKeyText)).toBe(true);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: u.id },
		});
		expect(Buffer.from(set.kdfSalt)).toEqual(Buffer.from(m.salt));
		expect(Buffer.from(set.publicKey)).toEqual(Buffer.from(m.publicKey));
		expect([set.kdfMemoryKiB, set.kdfPasses, set.version]).toEqual([
			65536, 3, 1,
		]);
		expect(done.createdAt).toBe(set.createdAt.toISOString());
		const wraps = await adminDb.protectionKeyWrap.findMany({
			where: { userId: u.id },
		});
		expect(wraps.map((w) => `${w.role}|${w.targetId}`).sort()).toEqual(
			m.wraps.map((w) => `${w.role}|${w.targetId}`).sort(),
		);
		for (const sent of m.wraps)
			expect(
				Buffer.from(
					wraps.find((w) => w.role === sent.role)?.wrapped ?? [],
				).toString("hex"),
			).toBe(Buffer.from(sent.wrapped).toString("hex"));
		// Nothing is sealed: only the way in changed.
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
		expect(audit[0]?.metadata).toEqual({
			reason: "protection_keys_created",
		});
		expect(JSON.stringify(audit[0])).not.toContain(u.email);
		const outbox = await adminDb.apiEvent.findMany({
			where: { actorUserId: u.id, type: "user.protection_keys_created" },
		});
		expect(outbox).toHaveLength(1);

		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		const [to, subject, html] = mail.sendEmail.mock.calls[0] as unknown as [
			string,
			string,
			string,
		];
		expect(to).toBe(u.email);
		expect(subject).toBe("Advanced protection keys were created");
		for (const secret of [m.authKeyText, PASSWORD, "Lucía", u.id])
			expect(html).not.toContain(secret);
	});

	it("is all or nothing when the database fails after the password write", async () => {
		const u = await passwordUser();
		const other = await passwordUser();
		// A wrap id that already exists makes the last insert fail with 23505,
		// after the hash was swapped and the set was created.
		const taken = randomUUID();
		await adminDb.protectionKeySet.create({
			data: {
				userId: other.id,
				kdfSalt: new Uint8Array(16),
				kdfMemoryKiB: 65536,
				kdfPasses: 3,
				publicKey: new Uint8Array(32).fill(1),
			},
		});
		const filler = made(other.id).wraps[0];
		if (!filler) throw new Error("no wrap");
		await adminDb.protectionKeyWrap.create({
			data: {
				id: taken,
				userId: other.id,
				role: "ak-password",
				targetId: other.id,
				wrapped: Uint8Array.from(filler.wrapped),
			},
		});
		const me = await mobile(u.id);
		const otherSession = await sessionFor(u.id);
		const token = await resetToken(u.email);
		const before = await storedHash(u.id);
		const m = made(u.id);
		const body = bodyOf(m);
		const res = await enable(me.headers, {
			...body,
			wraps: body.wraps.map((w, i) => (i === 3 ? { ...w, id: taken } : w)),
		});
		await expectProblem(res, 409, "conflict");

		expect(await storedHash(u.id)).toBe(before);
		expect(await signsInWith(u.email, PASSWORD)).toBe(true);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		expect(await sessionExists(otherSession)).toBe(true);
		expect(
			await adminDb.passwordResetToken.count({ where: { token: token.token } }),
		).toBe(1);
		expect(
			await adminDb.eventLog.count({
				where: { userId: u.id, eventType: "PASSWORD_CHANGED" },
			}),
		).toBe(0);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		// The other account's wrap is untouched.
		expect(await keyRows(other.id)).toEqual({ sets: 1, wraps: 1 });
	});

	it("lets exactly one of two sessions win, and the stored hash is the winner's", async () => {
		const u = await passwordUser();
		const a = await mobile(u.id);
		const b = await mobile(u.id);
		const ma = made(u.id);
		const mb = made(u.id);
		const [ra, rb] = await Promise.all([
			enable(a.headers, bodyOf(ma)),
			enable(b.headers, bodyOf(mb)),
		]);
		const statuses = [ra.status, rb.status].sort();
		expect(statuses).toEqual([200, 409]);
		const winner = ra.status === 200 ? ma : mb;
		const loser = ra.status === 200 ? mb : ma;
		await expectProblem(ra.status === 200 ? rb : ra, 409, "conflict");

		expect(
			await verifyPassword({
				password: winner.authKeyText,
				hash: await storedHash(u.id),
			}),
		).toBe(true);
		expect(
			await verifyPassword({
				password: loser.authKeyText,
				hash: await storedHash(u.id),
			}),
		).toBe(false);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: u.id },
		});
		expect(Buffer.from(set.kdfSalt)).toEqual(Buffer.from(winner.salt));
		expect(await keyRows(u.id)).toEqual({ sets: 1, wraps: 4 });
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
	});

	it("waits behind a writer holding the credential lock and then answers conflict if keys appeared", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const before = await storedHash(u.id);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let locked!: () => void;
		const hasLock = new Promise<void>((resolve) => {
			locked = resolve;
		});
		const holder = adminDb.$transaction(
			async (tx) => {
				await lockCredential(tx, u.id);
				locked();
				await gate;
				await tx.protectionKeySet.create({
					data: {
						userId: u.id,
						kdfSalt: new Uint8Array(16).fill(1),
						kdfMemoryKiB: 65536,
						kdfPasses: 3,
						publicKey: new Uint8Array(32).fill(2),
					},
				});
			},
			{ timeout: 30_000 },
		);
		await hasLock;
		const pending = enable(me.headers, bodyOf(made(u.id)));
		const deadline = Date.now() + 15_000;
		let waiting = 0;
		while (waiting === 0 && Date.now() < deadline) {
			const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
				SELECT count(*)::int AS waiting FROM pg_stat_activity
				WHERE datname = current_database() AND wait_event_type = 'Lock'`;
			waiting = row?.waiting ?? 0;
			if (waiting === 0) await new Promise((r) => setTimeout(r, 25));
		}
		expect(waiting).toBeGreaterThan(0);
		release();
		await holder;
		await expectProblem(await pending, 409, "conflict");
		expect(await storedHash(u.id)).toBe(before);
		expect(await keyRows(u.id)).toEqual({ sets: 1, wraps: 0 });
	});

	it("counts a wrong current password as a try and changes nothing, then stops at the limit", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const other = await sessionFor(u.id);
		const before = await storedHash(u.id);
		const m = made(u.id);
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await enable(me.headers, bodyOf(m, { currentPassword: "Not mine 1" })),
				400,
				"wrong_password",
			);
		expect(await storedHash(u.id)).toBe(before);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		expect(await sessionExists(other)).toBe(true);
		// The sixth try is refused even with the right password.
		const res = await enable(me.headers, bodyOf(m));
		await expectProblem(res, 429, "rate_limited");
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
	});

	it("is refused with 501 when the server does not offer it, and writes nothing", async () => {
		flag.on = false;
		const u = await passwordUser();
		const me = await mobile(u.id);
		const before = await storedHash(u.id);
		await expectProblem(
			await enable(me.headers, bodyOf(made(u.id))),
			501,
			"not_implemented",
		);
		expect(await storedHash(u.id)).toBe(before);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
	});

	it("is refused until the email is verified", async () => {
		const u = await passwordUser({ verified: false });
		const me = await mobile(u.id);
		const before = await storedHash(u.id);
		await expectProblem(
			await enable(me.headers, bodyOf(made(u.id))),
			403,
			"forbidden",
		);
		expect(await storedHash(u.id)).toBe(before);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
	});

	it("needs a session made in the last 10 minutes", async () => {
		const u = await passwordUser();
		const stale = await mobile(u.id);
		await adminDb.session.update({
			where: { id: stale.id },
			data: { createdAt: new Date(Date.now() - 11 * MIN) },
		});
		const before = await storedHash(u.id);
		await expectProblem(
			await enable(stale.headers, bodyOf(made(u.id))),
			403,
			"session_not_fresh",
		);
		expect(await storedHash(u.id)).toBe(before);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		// The same session a minute younger than the limit passes.
		await adminDb.session.update({
			where: { id: stale.id },
			data: { createdAt: new Date(Date.now() - 9 * MIN) },
		});
		await expectBody(
			await enable(stale.headers, bodyOf(made(u.id))),
			route.enable,
		);
	});

	describe("with two-factor on", () => {
		const SECRET = "JBSWY3DPEHPK3PXP";
		async function twoFactorUser() {
			const u = await passwordUser();
			await adminDb.twoFactor.create({
				data: {
					id: randomUUID(),
					userId: u.id,
					secret: await symmetricEncrypt({
						key: (await auth.$context).secretConfig,
						data: SECRET,
					}),
					backupCodes: "[]",
					verified: true,
				},
			});
			await adminDb.user.update({
				where: { id: u.id },
				data: { twoFactorEnabled: true },
			});
			return u;
		}
		/** The code better-auth's own generator makes for this secret now. */
		const codeNow = async () =>
			(await auth.api.generateTOTP({ body: { secret: SECRET } })).code;

		it("refuses a missing or wrong code and changes nothing, and accepts the right one", async () => {
			const u = await twoFactorUser();
			const me = await mobile(u.id);
			const before = await storedHash(u.id);
			const m = made(u.id);
			await expectProblem(
				await enable(me.headers, bodyOf(m)),
				400,
				"two_factor_required",
			);
			const right = await codeNow();
			const wrong = right === "000000" ? "000001" : "000000";
			await expectProblem(
				await enable(me.headers, bodyOf(m, { totpCode: wrong })),
				400,
				"wrong_two_factor_code",
			);
			expect(await storedHash(u.id)).toBe(before);
			expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });

			await expectBody(
				await enable(me.headers, bodyOf(m, { totpCode: await codeNow() })),
				route.enable,
			);
			expect(await keyRows(u.id)).toEqual({ sets: 1, wraps: 4 });
		});

		it("accepts one step of clock drift and not two", async () => {
			const u = await twoFactorUser();
			// The middle of a 30 second step, so the code and every check below
			// belong to one known step whatever the real time is.
			const at = Math.floor(Date.now() / 30_000) * 30_000 + 15_000;
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(at);
			const code = await codeNow();
			vi.useRealTimers();
			for (const drift of [0, 30_000, -30_000])
				expect(await verifyTwoFactorCode(u.id, code, at + drift)).toBe(true);
			for (const drift of [60_000, -60_000])
				expect(await verifyTwoFactorCode(u.id, code, at + drift)).toBe(false);
		});
	});

	it("answers a second turn-on with conflict and changes nothing", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		await expectBody(
			await enable(me.headers, bodyOf(made(u.id))),
			route.enable,
		);
		const hash = await storedHash(u.id);
		mail.sendEmail.mockClear();
		await expectProblem(
			await enable(me.headers, bodyOf(made(u.id))),
			409,
			"conflict",
		);
		expect(await storedHash(u.id)).toBe(hash);
		expect(await keyRows(u.id)).toEqual({ sets: 1, wraps: 4 });
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it("replays the first answer for the same key without writing again", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const m = made(u.id);
		const key = randomUUID();
		const first = await enable(me.headers, bodyOf(m), key);
		const firstBody = await expectBody(first, route.enable);
		const hash = await storedHash(u.id);
		const second = await enable(me.headers, bodyOf(m), key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await expectBody(second, route.enable)).toEqual(firstBody);
		expect(await storedHash(u.id)).toBe(hash);
		expect(await keyRows(u.id)).toEqual({ sets: 1, wraps: 4 });
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(
			await adminDb.eventLog.count({
				where: { userId: u.id, eventType: "PASSWORD_CHANGED" },
			}),
		).toBe(1);
	});

	it("refuses a sign-in secret that is not 32 bytes of canonical base64url, before any try is spent", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		const m = made(u.id);
		const body = bodyOf(m);
		// 43 characters whose last one carries a spare bit: a second text for the same bytes.
		const loose = `${m.authKeyText.slice(0, -1)}9`;
		const res = await enable(me.headers, { ...body, authKey: loose });
		expect(res.status).toBe(400);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
		// A request with the wrong roles is refused the same way.
		const res2 = await enable(me.headers, {
			...body,
			wraps: body.wraps.map((w, i) =>
				i === 3 ? { ...w, role: "ak-recovery", targetId: u.id } : w,
			),
		});
		expect(res2.status).toBe(400);
		expect(await keyRows(u.id)).toEqual({ sets: 0, wraps: 0 });
	});
});

describe("GET /me/protection/keys", () => {
	it("is 404 before, and the creation time, version and kdf after", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		await expectProblem(
			await call("/me/protection/keys", { headers: me.headers }),
			404,
			"not_found",
		);
		const m = made(u.id);
		await expectBody(await enable(me.headers, bodyOf(m)), route.enable);
		const keys = await expectBody<{
			createdAt: string;
			version: number;
			kdf: { salt: string; memoryKiB: number; passes: number };
		}>(await call("/me/protection/keys", { headers: me.headers }), route.keys);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: u.id },
		});
		expect(keys).toEqual({
			createdAt: set.createdAt.toISOString(),
			version: 1,
			kdf: { salt: toBase64Url(m.salt), memoryKiB: 65536, passes: 3 },
		});
		// No wrap or key leaves in K1.
		expect(JSON.stringify(keys)).not.toContain(toBase64Url(m.publicKey));
	});

	it("is only for the person's own session", async () => {
		const u = await passwordUser();
		const res = await call("/me/protection/keys", {
			headers: await asKey(u.id, ["read"]),
		});
		await expectProblem(res, 403, "missing_scope");
	});
});

describe("an account with protection on", () => {
	it("still reaches both routes, and not the ledger", async () => {
		const u = await passwordUser();
		const me = await mobile(u.id);
		await expectBody(
			await enable(me.headers, bodyOf(made(u.id))),
			route.enable,
		);
		await adminDb.user.update({
			where: { id: u.id },
			data: { protectionState: "ON" },
		});
		await expectBody(
			await call("/me/protection/keys", { headers: me.headers }),
			route.keys,
		);
		// The allowlist lets it through to the service, which answers conflict
		// (keys exist), not protected_account.
		await expectProblem(
			await enable(me.headers, bodyOf(made(u.id))),
			409,
			"conflict",
		);
		// A control that the state is in force: a ledger route is refused.
		await expectProblem(
			await call("/categories", { headers: me.headers }),
			403,
			"protected_account",
		);
	});
});
