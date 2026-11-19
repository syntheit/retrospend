/**
 * The recovery routes on Postgres (E2EE K3-2b), through the same fetch handler
 * the Next route uses: POST /auth/recovery/check, /begin and the commit. The
 * service's own rules (the proof, the tries, the commit's all-or-nothing) are
 * the service test's; these are what the routes add: public and sessionless,
 * the one sender bucket, the problem codes, and no Idempotency-Key. Fixtures
 * are the service test's (src/test/recoverable.ts).
 */
import { randomBytes } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { type Primitives, signInSecret, toBase64Url } from "@retrospend/crypto";
import { verifyPassword } from "better-auth/crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { getClientIp, ipBucket } from "~/server/lib/rate-limiter";
import { RECOVERY_TRIES } from "~/server/services/account-security.service";
import { hashToken } from "~/server/lib/tokens";
import { issueLinkFor } from "~/test/reset-links";
import {
	clearTriesWindowEdge,
	commitBody,
	loadPrimitives,
	passwordUser,
	type Recoverable,
	recoverable,
	seedApiKey,
	snapshot,
	storedHash,
	triesSpent,
	wrapBytes,
} from "~/test/recoverable";
import {
	adminDb,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	sessionFor,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({
	sendEmail: vi.fn(async (_to: string, _subject: string, _html: string) => {}),
}));
vi.mock("~/server/mailer", () => mail);
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => true,
}));
// The recovery routes are not behind the flag: it stays off here on purpose.
vi.mock("~/env", async (original) => {
	const actual = await original<typeof import("~/env")>();
	return {
		...actual,
		env: new Proxy(actual.env, {
			get: (target, key) =>
				key === "ADVANCED_PROTECTION_ENABLED"
					? false
					: Reflect.get(target, key),
		}),
	};
});
// Real implementations, watched: a recovery route must call neither.
const spies = vi.hoisted(() => ({ keyring: vi.fn(), zone: vi.fn() }));
vi.mock("~/server/services/keys/data-key.service", async (original) => {
	const actual =
		await original<typeof import("~/server/services/keys/data-key.service")>();
	spies.keyring.mockImplementation(actual.ensureUserKeyringWhenSealing);
	return { ...actual, ensureUserKeyringWhenSealing: spies.keyring };
});
vi.mock("~/server/services/user-time-zone", async (original) => {
	const actual =
		await original<typeof import("~/server/services/user-time-zone")>();
	spies.zone.mockImplementation(actual.userTimeZone);
	return { ...actual, userTimeZone: spies.zone };
});

const routes = contract.auth;

let p: Primitives;
beforeAll(async () => {
	p = await loadPrimitives();
});
beforeEach(() => {
	mail.sendEmail.mockClear();
	spies.keyring.mockClear();
	spies.zone.mockClear();
});
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

// Every request has its own sender, so the one bucket of another request never counts.
let n = 0;
const nextIp = () => `198.51.${(n >> 8) & 255}.${n++ & 255}`;

type Extra = { headers?: Record<string, string>; ip?: string };
const send = (path: string, body: unknown, extra: Extra = {}) =>
	call(`/auth/recovery${path}`, {
		method: "POST",
		body,
		headers: { "x-forwarded-for": extra.ip ?? nextIp(), ...extra.headers },
	});
const check = (token: string, extra?: Extra) =>
	send("/check", { token }, extra);
const begin = (token: string, recoveryAuthKey: string, extra?: Extra) =>
	send("/begin", { token, recoveryAuthKey }, extra);
const commit = (input: unknown, extra?: Extra) => send("", input, extra);

const wrongKey = () => signInSecret(p.randomBytes(32));
const randomToken = () => randomBytes(32).toString("hex");
const hash = (token: string) => hashToken(token);

/** An account with a key set and a link, and an admin-made, an expired and a spent link of it. */
async function badLinks(k: Recoverable) {
	const admin = await issueLinkFor(k.id, "admin");
	const expired = await issueLinkFor(
		k.id,
		"email",
		new Date(Date.now() - 2 * 3_600_000),
	);
	return { admin, expired, unknown: randomToken() };
}

describe("POST /auth/recovery/check", () => {
	it("says what the link leads to, for each kind of account", async () => {
		const withKey = await recoverable();
		const on = await recoverable({ state: "ON" });
		const plain = await passwordUser();
		const plainToken = await issueLinkFor(plain.id);
		const old = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: old.id },
			data: { recoveryHash: null },
		});

		const answer = async (token: string) =>
			expectBody(await check(token), routes.checkRecovery);
		expect(await answer(withKey.token)).toEqual({
			keys: "recovery",
			protectionOn: false,
		});
		expect(await answer(on.token)).toEqual({
			keys: "recovery",
			protectionOn: true,
		});
		expect(await answer(plainToken)).toEqual({
			keys: "none",
			protectionOn: false,
		});
		expect(await answer(old.token)).toEqual({
			keys: "noRecovery",
			protectionOn: false,
		});
	});

	it("answers 404 invalid_token for an unknown, expired, admin-made and spent link, and spends no try", async () => {
		const k = await recoverable();
		const bad = await badLinks(k);
		const spent = await issueLinkFor(k.id);
		await adminDb.passwordResetToken.deleteMany({
			where: { token: hash(spent) },
		});
		for (const token of [bad.unknown, bad.expired, bad.admin, spent]) {
			await expectProblem(await check(token), 404, "invalid_token");
			expect(await triesSpent(hash(token))).toBe(0);
		}
		// A live link of the same account still answers.
		expect((await check(k.token)).status).toBe(200);
		expect(await triesSpent(hash(k.token))).toBe(0);
	});

	it("is reached with no Idempotency-Key and no session, and refuses a malformed body", async () => {
		const k = await recoverable();
		expect((await check(k.token)).status).toBe(200);
		await expectProblem(await send("/check", {}), 400, "validation_failed");
		await expectProblem(
			await send("/check", { token: "" }),
			400,
			"validation_failed",
		);
	});
});

describe("POST /auth/recovery/begin", () => {
	it("releases the ak-recovery and private-key wraps, and nothing else, for the right proof", async () => {
		const k = await recoverable();
		const body = await expectBody<{
			userId: string;
			version: number;
			publicKey: string;
			wraps: { role: string; targetId: string; wrapped: string }[];
		}>(await begin(k.token, k.recoveryAuthKey), routes.beginRecovery);

		expect(body.userId).toBe(k.id);
		expect(body.version).toBe(1);
		expect(body.publicKey).toBe(toBase64Url(k.publicKey));
		expect(body.wraps.map((w) => w.role).sort()).toEqual([
			"ak-recovery",
			"private-key",
		]);
		for (const wrap of body.wraps) {
			expect(wrap.targetId).toBe(k.id);
			expect(wrap.wrapped).toBe(await wrapBytes(k.id, wrap.role));
		}
		// The seeded password, collection and device wraps never appear, as bytes either.
		const text = JSON.stringify(body);
		for (const role of ["ak-password", "collection-key", "ak-device"]) {
			const stored = await adminDb.protectionKeyWrap.findFirstOrThrow({
				where: { userId: k.id, role },
			});
			expect(text).not.toContain(toBase64Url(stored.wrapped));
		}
		expect(await triesSpent(hash(k.token))).toBe(1);
	});

	it("answers 400 wrong_recovery_key for a wrong proof, with no wrap, and spends a try", async () => {
		const k = await recoverable();
		const other = await recoverable();
		for (const proof of [wrongKey(), other.recoveryAuthKey]) {
			const res = await begin(k.token, proof);
			const text = await res.clone().text();
			await expectProblem(res, 400, "wrong_recovery_key");
			expect(text).not.toContain(await wrapBytes(k.id, "ak-recovery"));
		}
		expect(await triesSpent(hash(k.token))).toBe(2);
	});

	it("answers 404 invalid_token for a bad link before it spends a try or compares the proof", async () => {
		const k = await recoverable();
		const bad = await badLinks(k);
		for (const token of [bad.unknown, bad.expired, bad.admin]) {
			// The right proof: only the link says no.
			await expectProblem(
				await begin(token, k.recoveryAuthKey),
				404,
				"invalid_token",
			);
			expect(await triesSpent(hash(token))).toBe(0);
		}
		expect(
			await adminDb.apiRateLimit.count({
				where: { key: `recovery:user:${k.id}` },
			}),
		).toBe(0);
	});

	it("answers 409 recovery_unavailable for keys without a recovery proof, and 404 for an account without keys", async () => {
		const old = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: old.id },
			data: { recoveryHash: null },
		});
		await expectProblem(
			await begin(old.token, old.recoveryAuthKey),
			409,
			"recovery_unavailable",
		);
		const plain = await passwordUser();
		await expectProblem(
			await begin(await issueLinkFor(plain.id), wrongKey()),
			404,
			"not_found",
		);
	});

	it("refuses a malformed proof before any try", async () => {
		const k = await recoverable();
		for (const proof of ["short", `${"A".repeat(42)}=`, "A".repeat(44)])
			await expectProblem(
				await send("/begin", { token: k.token, recoveryAuthKey: proof }),
				400,
				"validation_failed",
			);
		expect(await triesSpent(hash(k.token))).toBe(0);
	});

	it("answers 429 with Retry-After on the 6th try of one link, whatever the proof", async () => {
		await clearTriesWindowEdge();
		const k = await recoverable();
		for (let i = 0; i < RECOVERY_TRIES.perToken; i++)
			await expectProblem(
				await begin(k.token, wrongKey()),
				400,
				"wrong_recovery_key",
			);
		const refused = await begin(k.token, k.recoveryAuthKey);
		await expectProblem(refused, 429, "rate_limited");
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		// The refused try is counted too: a window that fills stays full.
		expect(await triesSpent(hash(k.token))).toBe(RECOVERY_TRIES.perToken + 1);
	});

	it("counts the tries of every link of one account together", async () => {
		await clearTriesWindowEdge();
		const k = await recoverable();
		const second = await issueLinkFor(k.id);
		const third = await issueLinkFor(k.id);
		for (const token of [k.token, second])
			for (let i = 0; i < RECOVERY_TRIES.perUser / 2; i++)
				await expectProblem(
					await begin(token, wrongKey()),
					400,
					"wrong_recovery_key",
				);
		// The third link has spent nothing of its own and is refused all the same.
		await expectProblem(
			await begin(third, k.recoveryAuthKey),
			429,
			"rate_limited",
		);
		expect(await triesSpent(hash(third))).toBe(1);
	});
});

describe("POST /auth/recovery", () => {
	it("sets the new password with no Idempotency-Key, ends every session and API key, and spends the link", async () => {
		const k = await recoverable();
		await sessionFor(k.id);
		await sessionFor(k.id);
		const key = await seedApiKey(k.id);
		const before = await wrapBytes(k.id, "ak-password");
		const mine = commitBody(p, k);

		mail.sendEmail.mockClear(); // sign-up sent its own verification mail
		const res = await commit(mine.input);
		const body = await expectBody<{ version: number; signedOut: number }>(
			res,
			routes.recover,
		);
		expect(body).toEqual({ version: 2, signedOut: 2 });

		expect(
			await verifyPassword({
				password: mine.newAuthKey,
				hash: await storedHash(k.id),
			}),
		).toBe(true);
		expect(await wrapBytes(k.id, "ak-password")).toBe(
			toBase64Url(mine.wrapped),
		);
		expect(await wrapBytes(k.id, "ak-password")).not.toBe(before);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: k.id },
		});
		expect(toBase64Url(set.kdfSalt)).toBe(mine.input.kdf.salt);
		expect(await adminDb.session.count({ where: { userId: k.id } })).toBe(0);
		expect(await adminDb.apikey.count({ where: { id: key } })).toBe(0);
		expect(
			await adminDb.passwordResetToken.count({ where: { userId: k.id } }),
		).toBe(0);
		// No idempotency row was made: the link is the single-use proof.
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: k.id } }),
		).toBe(0);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(mail.sendEmail.mock.calls[0]?.[0]).toBe(k.email);
	});

	it("works for an account with protection on, and leaves it on", async () => {
		const k = await recoverable({ state: "ON" });
		const mine = commitBody(p, k);
		expect((await commit(mine.input)).status).toBe(200);
		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: k.id } }))
				.protectionState,
		).toBe("ON");
	});

	it("answers 404 invalid_token to a replay, and changes nothing the second time", async () => {
		const k = await recoverable();
		const mine = commitBody(p, k);
		expect((await commit(mine.input)).status).toBe(200);
		const after = await snapshot(k.id);
		await expectProblem(await commit(mine.input), 404, "invalid_token");
		expect(await snapshot(k.id)).toBe(after);
	});

	it("answers 404 invalid_token for an unknown, expired or admin-made link, with the right proof, and changes nothing", async () => {
		const k = await recoverable();
		const bad = await badLinks(k);
		const before = await snapshot(k.id);
		for (const token of [bad.unknown, bad.expired, bad.admin])
			await expectProblem(
				await commit(commitBody(p, k, { token }).input),
				404,
				"invalid_token",
			);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("re-checks the proof by itself: a wrong one is 400 wrong_recovery_key and nothing changes", async () => {
		const k = await recoverable();
		const before = await snapshot(k.id);
		await expectProblem(
			await commit(commitBody(p, k, { recoveryAuthKey: wrongKey() }).input),
			400,
			"wrong_recovery_key",
		);
		expect(await snapshot(k.id)).toBe(before);
		// The link is not spent: the right proof still works.
		expect((await commit(commitBody(p, k).input)).status).toBe(200);
	});

	it("answers 409 for a stale version and for keys without a recovery proof, and leaves the link unspent", async () => {
		const k = await recoverable();
		const before = await snapshot(k.id);
		await expectProblem(
			await commit(commitBody(p, k, { baseVersion: 2 }).input),
			409,
			"conflict",
		);
		expect(await snapshot(k.id)).toBe(before);

		const old = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: old.id },
			data: { recoveryHash: null },
		});
		await expectProblem(
			await commit(commitBody(p, old).input),
			409,
			"recovery_unavailable",
		);
		expect(
			await adminDb.passwordResetToken.count({ where: { userId: old.id } }),
		).toBe(1);
	});

	it("answers 429 on the 6th try of one link and changes nothing", async () => {
		await clearTriesWindowEdge();
		const k = await recoverable();
		const before = await snapshot(k.id);
		for (let i = 0; i < RECOVERY_TRIES.perToken; i++)
			await expectProblem(
				await commit(commitBody(p, k, { recoveryAuthKey: wrongKey() }).input),
				400,
				"wrong_recovery_key",
			);
		const refused = await commit(commitBody(p, k).input);
		await expectProblem(refused, 429, "rate_limited");
		expect(refused.headers.get("retry-after")).not.toBeNull();
		expect(await snapshot(k.id)).toBe(before);
	});

	it("takes B's link with A's proof as a wrong proof, and changes neither account", async () => {
		const a = await recoverable();
		const b = await recoverable();
		const beforeA = await snapshot(a.id);
		const beforeB = await snapshot(b.id);
		await expectProblem(
			await commit(
				commitBody(p, b, { recoveryAuthKey: a.recoveryAuthKey }).input,
			),
			400,
			"wrong_recovery_key",
		);
		expect(await snapshot(a.id)).toBe(beforeA);
		expect(await snapshot(b.id)).toBe(beforeB);
	});

	it("refuses a malformed body before anything runs", async () => {
		const k = await recoverable();
		const mine = commitBody(p, k).input;
		const before = await snapshot(k.id);
		for (const bad of [
			{ ...mine, newAuthKey: "short" },
			{ ...mine, wrappedAccountKey: "" },
			{ ...mine, kdf: { ...mine.kdf, salt: "short" } },
			{ ...mine, baseVersion: 0 },
			{ ...mine, token: "" },
		])
			await expectProblem(await commit(bad), 400, "validation_failed");
		expect(await snapshot(k.id)).toBe(before);
		expect(await triesSpent(hash(k.token))).toBe(0);
	});
});

describe("with another account's session", () => {
	it("acts on the link's account only, and makes nothing under the cookie's user", async () => {
		const victim = await recoverable();
		const bystander = await recoverable();
		const cookie = await webCookieFor(bystander.id);
		const bearer = {
			authorization: `Bearer ${await sessionFor(bystander.id)}`,
		};
		const keyBefore = await seedApiKey(bystander.id);
		const bystanderBefore = await snapshot(bystander.id);
		spies.keyring.mockClear();
		spies.zone.mockClear();

		// Check and begin answer for the link's account.
		for (const headers of [cookie, bearer]) {
			expect(
				await expectBody(
					await check(victim.token, { headers }),
					routes.checkRecovery,
				),
			).toMatchObject({ keys: "recovery" });
		}
		const begun = await expectBody<{ userId: string }>(
			await begin(victim.token, victim.recoveryAuthKey, { headers: cookie }),
			routes.beginRecovery,
		);
		expect(begun.userId).toBe(victim.id);

		// The commit changes the victim and nobody else.
		const mine = commitBody(p, victim);
		const res = await commit(mine.input, {
			headers: { ...cookie, "idempotency-key": `recovery-${victim.id}` },
		});
		const done = await expectBody<{ signedOut: number }>(res, routes.recover);
		expect(done.signedOut).toBe(0);
		expect(
			await verifyPassword({
				password: mine.newAuthKey,
				hash: await storedHash(victim.id),
			}),
		).toBe(true);

		// The cookie's user: untouched, and no row, keyring, zone or token limit is theirs.
		expect(await adminDb.apikey.count({ where: { id: keyBefore } })).toBe(1);
		expect(await snapshot(bystander.id)).toBe(bystanderBefore);
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: bystander.id } }),
		).toBe(0);
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: victim.id } }),
		).toBe(0);
		expect(
			await adminDb.apiEvent.count({ where: { userId: bystander.id } }),
		).toBe(0);
		expect(spies.keyring).not.toHaveBeenCalled();
		expect(spies.zone).not.toHaveBeenCalled();
		expect(
			await adminDb.apiRateLimit.count({
				where: { key: { startsWith: "tok:" } },
			}),
		).toBe(0);
	});

	it("never gets the session user's own tries or wraps: a link of another account with the cookie user's recovery key is a wrong proof", async () => {
		const victim = await recoverable();
		const bystander = await recoverable();
		const cookie = await webCookieFor(bystander.id);
		await expectProblem(
			await begin(victim.token, bystander.recoveryAuthKey, { headers: cookie }),
			400,
			"wrong_recovery_key",
		);
		expect(await triesSpent(hash(bystander.token))).toBe(0);
	});
});

describe("the flag and the page it is called from", () => {
	it("works with the flag off, where the keys routes answer 501", async () => {
		const k = await recoverable();
		await expectProblem(
			await call("/me/protection/keys/open", {
				method: "POST",
				body: { authKey: wrongKey() },
				headers: await webCookieFor(k.id),
			}),
			501,
			"not_implemented",
		);
		expect((await check(k.token)).status).toBe(200);
		expect((await begin(k.token, k.recoveryAuthKey)).status).toBe(200);
		expect((await commit(commitBody(p, k).input)).status).toBe(200);
	});

	it("is reached from a cross-site page with no session, as any public POST is", async () => {
		const k = await recoverable();
		const res = await check(k.token, {
			headers: { "sec-fetch-site": "cross-site" },
		});
		expect(res.status).toBe(200);
	});
});

describe("the one sender bucket", () => {
	/** A bucket counts in fixed one-minute windows: a test that fills one must not straddle two. */
	async function clearMinuteEdge(): Promise<void> {
		const left = 60_000 - (Date.now() % 60_000);
		if (left < 12_000) await new Promise((r) => setTimeout(r, left + 500));
	}

	it("counts check, begin and commit together: the 11th request of one sender in a minute is 429", async () => {
		await clearMinuteEdge();
		const sender = { ip: "192.0.2.77" };
		const token = randomToken();
		const wrong = wrongKey();
		const body = {
			token,
			recoveryAuthKey: wrong,
			newAuthKey: wrong,
			kdf: { salt: "A".repeat(22), memoryKiB: 65536, passes: 3 },
			wrappedAccountKey: "A".repeat(100),
			baseVersion: 1,
		};
		// Unknown links: each is a 404 that costs the sender one of its ten.
		for (let i = 0; i < 4; i++)
			await expectProblem(await check(token, sender), 404, "invalid_token");
		for (let i = 0; i < 3; i++)
			await expectProblem(
				await begin(token, wrong, sender),
				404,
				"invalid_token",
			);
		for (let i = 0; i < 3; i++)
			await expectProblem(await commit(body, sender), 404, "invalid_token");
		const refused = await check(token, sender);
		await expectProblem(refused, 429, "rate_limited");
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		// Another route of the same sender is refused too, and another sender is not.
		await expectProblem(await begin(token, wrong, sender), 429, "rate_limited");
		await expectProblem(await commit(body, sender), 429, "rate_limited");
		await expectProblem(await check(token), 404, "invalid_token");
	}, 60_000);

	it("is named by the sender's address, and holds no address or token", async () => {
		await clearMinuteEdge();
		const ip = "192.0.2.88";
		const token = randomToken();
		await check(token, { ip });
		const key = `recovery:ip:${ipBucket(getClientIp(new Headers({ "x-forwarded-for": ip })))}`;
		const row = await adminDb.apiRateLimit.findUnique({ where: { key } });
		expect(row?.count).toBe(1);
		const keys = (
			await adminDb.apiRateLimit.findMany({ select: { key: true } })
		).map((r) => r.key);
		for (const stored of keys) expect(stored).not.toContain(token);
	});
});

describe("what never reaches a log", () => {
	it("keeps the link, the proof and the wraps out of every line the routes log", async () => {
		const k = await recoverable();
		const lines: string[] = [];
		const sinks = (["log", "info", "warn", "error", "debug"] as const).map(
			(name) =>
				vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
					lines.push(args.map((a) => String(a)).join(" "));
				}),
		);
		try {
			await begin(k.token, wrongKey());
			await begin(randomToken(), k.recoveryAuthKey);
			const mine = commitBody(p, k);
			await commit(mine.input);
			await commit(mine.input);
		} finally {
			for (const sink of sinks) sink.mockRestore();
		}
		const secrets = [
			k.token,
			k.recoveryAuthKey,
			await wrapBytes(k.id, "ak-recovery"),
			await wrapBytes(k.id, "private-key"),
		];
		for (const line of lines)
			for (const secret of secrets) expect(line).not.toContain(secret);
	});
});

describe("a plain account is not drawn into recovery", () => {
	it("gets keys none, and begin and commit answer 404 not_found, never a wrap", async () => {
		const plain = await createTestUser();
		const token = await issueLinkFor(plain.user.id);
		expect(await expectBody(await check(token), routes.checkRecovery)).toEqual({
			keys: "none",
			protectionOn: false,
		});
		await expectProblem(await begin(token, wrongKey()), 404, "not_found");
		// A well-formed body (wrap bytes the checks accept) for an account with no keys.
		const body = commitBody(p, await recoverable(), { token }).input;
		await expectProblem(await commit(body), 404, "not_found");
		expect(
			await adminDb.passwordResetToken.count({
				where: { userId: plain.user.id },
			}),
		).toBe(1);
	});
});
