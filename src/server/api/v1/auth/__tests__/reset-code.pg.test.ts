/**
 * The phone's reset code on Postgres (E2EE K3-5a), through the same fetch
 * handler the Next route uses: POST /auth/password-reset mails a code and
 * POST /auth/password-reset/code swaps it for a recovery token. What the
 * token does afterward is the recovery routes' own test; here it is shown to
 * open recovery and never the plain reset. Expiry is driven by the `now` the
 * service takes, never by sleeping.
 */
import { randomBytes } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import type { Primitives } from "@retrospend/crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { authRouter } from "~/server/api/routers/auth";
import { createCallerFactory } from "~/server/api/trpc";
import { keyedHash } from "~/server/lib/keyed-hash";
import { hashToken } from "~/server/lib/tokens";
import { resetPasswordHash } from "~/server/services/account-security.service";
import {
	InvalidResetTokenError,
	issueResetCode,
	lookupPlainResetToken,
	lookupResetToken,
	PLAIN_RESET_ORIGINS,
	RESET_CODE_LENGTH,
	RESET_CODE_TRIES,
	RESET_CODE_TTL_MS,
	RESET_REQUESTS_PER_ADDRESS,
	redeemResetCode,
	resetAddressKey,
	resolveRecoveryToken,
	spendResetToken,
} from "~/server/services/auth/reset-tokens";
import { stayInWindow } from "~/test/rate-window";
import { issueLinkFor } from "~/test/reset-links";
import {
	commitBody,
	loadPrimitives,
	passwordUser,
	recoverable as makeRecoverable,
	storedHash,
} from "~/test/recoverable";
import {
	adminDb,
	call,
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
const delivery = vi.hoisted(() => ({ on: true }));
vi.mock("~/server/mailer", () => mail);
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => delivery.on,
}));
// Watched, not replaced: the real hash runs, the test counts the calls.
const hashing = vi.hoisted(() => ({ calls: 0 }));
vi.mock("better-auth/crypto", async (original) => {
	const actual = await original<typeof import("better-auth/crypto")>();
	return {
		...actual,
		hashPassword: (password: string) => {
			hashing.calls++;
			return actual.hashPassword(password);
		},
	};
});
// The reset routes are not behind the flag: it stays off here on purpose.
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
// Real implementations, watched: a public reset route must call neither.
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

/** Sign-up sends its own verification mail: a test that counts mail starts from none. */
async function recoverable() {
	const k = await makeRecoverable();
	mail.sendEmail.mockClear();
	return k;
}

const routes = contract.auth;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/;

let p: Primitives;
beforeAll(async () => {
	p = await loadPrimitives();
});
beforeEach(() => {
	delivery.on = true;
	mail.sendEmail.mockReset();
	mail.sendEmail.mockImplementation(async () => {});
	hashing.calls = 0;
	spies.keyring.mockClear();
	spies.zone.mockClear();
});
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

// Every request has its own sender, so the one bucket of another request never counts.
let n = 0;
const nextIp = () => `198.52.${(n >> 8) & 255}.${n++ & 255}`;

type Extra = { headers?: Record<string, string>; ip?: string };
const send = (path: string, body: unknown, extra: Extra = {}) =>
	call(path, {
		method: "POST",
		body,
		headers: { "x-forwarded-for": extra.ip ?? nextIp(), ...extra.headers },
	});
const request = (email: string, extra?: Extra) =>
	send("/auth/password-reset", { email }, extra);
const redeem = (email: string, code: string, extra?: Extra) =>
	send("/auth/password-reset/code", { email, code }, extra);
const recovery = (path: string, body: unknown, extra?: Extra) =>
	send(`/auth/recovery${path}`, body, extra);

const wrongCode = (not?: string) => {
	for (;;) {
		const code = randomBytes(8)
			.toString("hex")
			.slice(0, 8)
			.toUpperCase()
			.replace(/[ILOU]/g, "7");
		if (code !== not) return code;
	}
};
/** A code for the account, as the request would make it (the raw code, never stored). */
async function codeFor(k: { id: string; email: string }, now?: Date) {
	const code = await issueResetCode({ userId: k.id, forEmail: k.email, now });
	if (!code) throw new Error("the address changed while making a test code");
	return code;
}
const codeRows = (userId: string) =>
	adminDb.passwordResetToken.findMany({ where: { userId, origin: "code" } });
const phoneRows = (userId: string) =>
	adminDb.passwordResetToken.findMany({ where: { userId, origin: "phone" } });
const triesOf = async (key: string) =>
	(await adminDb.apiRateLimit.findUnique({ where: { key } }))?.count ?? 0;
const userTries = (userId: string) => triesOf(`reset-code:user:${userId}`);
const mailedCode = (call = 0) => {
	const html = mail.sendEmail.mock.calls[call]?.[2] ?? "";
	return /<p[^>]*>([0-9A-Z]{4}-[0-9A-Z]{4})<\/p>/.exec(html)?.[1] ?? "";
};
/** An address that has no account at all. */
const stranger = () => `${randomBytes(8).toString("hex")}@pg-test.invalid`;

const plainReset = (token: string) =>
	createCallerFactory(authRouter)({
		db: adminDb,
		headers: new Headers({ "x-forwarded-for": nextIp() }),
		session: null,
	} as never).resetPassword({ token, newPassword: "Battery staple 2" });

async function expectUnusable(res: Response) {
	await expectProblem(res, 404, "invalid_token");
}

describe("POST /auth/password-reset", () => {
	it("mails a code to a keyed account and stores only a keyed hash of it, bound to its row", async () => {
		const k = await recoverable();
		const before = Date.now();
		const res = await request(k.email);
		expect(await expectBody(res, routes.requestResetCode)).toEqual({
			success: true,
		});

		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(mail.sendEmail.mock.calls[0]?.[0]).toBe(k.email);
		const grouped = mailedCode();
		expect(grouped).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		const code = grouped.replace("-", "");
		expect(code).toHaveLength(RESET_CODE_LENGTH);
		expect(code).toMatch(CROCKFORD);
		// The mail holds words and the code, not the address or a name.
		expect(mail.sendEmail.mock.calls[0]?.[2]).not.toContain(k.email);

		const [row, ...rest] = await codeRows(k.id);
		expect(rest).toHaveLength(0);
		expect(row?.codeHash).toBe(
			keyedHash("resetCode", `${row?.token}|${k.id}|${code}`),
		);
		expect(row?.codeHash).not.toContain(code);
		expect(row?.token).not.toContain(code);
		// 15 minutes, from the moment it was made.
		const life = (row?.expires.getTime() ?? 0) - before;
		expect(life).toBeGreaterThan(RESET_CODE_TTL_MS - 5_000);
		expect(life).toBeLessThanOrEqual(RESET_CODE_TTL_MS + 5_000);
		// The email link is another thing: this request made none.
		expect(
			await adminDb.passwordResetToken.count({
				where: { userId: k.id, origin: "email" },
			}),
		).toBe(1);
	});

	it("answers alike for an unknown address, an account with no keys, keys with no recovery proof and a used-up address", async () => {
		const keyed = await recoverable();
		const plain = await passwordUser();
		const noProof = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: noProof.id },
			data: { recoveryHash: null },
		});
		const spent = await recoverable();
		for (let i = 0; i < RESET_REQUESTS_PER_ADDRESS.limit; i++)
			await request(spent.email);
		const answers: { status: number; body: string; hashes: number }[] = [];
		const mailsBefore = mail.sendEmail.mock.calls.length;
		for (const email of [
			keyed.email,
			stranger(),
			plain.email,
			noProof.email,
			spent.email,
		]) {
			hashing.calls = 0;
			const res = await request(email);
			answers.push({
				status: res.status,
				body: await res.text(),
				hashes: hashing.calls,
			});
		}
		// Status, body and the work done (one password hash) are one answer.
		expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
		expect(answers[0]).toEqual({
			status: 200,
			body: JSON.stringify({ success: true }),
			hashes: 1,
		});
		// Only the keyed account with a recovery key got a mail.
		const sent = mail.sendEmail.mock.calls.slice(mailsBefore);
		expect(sent.map((c) => c[0])).toEqual([keyed.email]);
		expect(await codeRows(plain.id)).toHaveLength(0);
		expect(await codeRows(noProof.id)).toHaveLength(0);
		expect(await codeRows(spent.id)).toHaveLength(RESET_REQUESTS_PER_ADDRESS.limit);
	});

	it("does not wait for the mail server: a stuck mailer gives the same fast answer", async () => {
		const k = await recoverable();
		mail.sendEmail.mockImplementation(() => new Promise(() => {}));
		const res = await request(k.email);
		expect(res.status).toBe(200);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
	});

	it("sends nothing on the 4th request of an hour from any sender, and answers as usual", async () => {
		stayInWindow(RESET_REQUESTS_PER_ADDRESS.windowMs);
		const k = await recoverable();
		for (let i = 0; i < RESET_REQUESTS_PER_ADDRESS.limit + 1; i++)
			expect((await request(k.email)).status).toBe(200);
		expect(mail.sendEmail).toHaveBeenCalledTimes(
			RESET_REQUESTS_PER_ADDRESS.limit,
		);
		expect(await codeRows(k.id)).toHaveLength(RESET_REQUESTS_PER_ADDRESS.limit);
		// The counter names the address by a keyed hash, never the address.
		expect(await triesOf(resetAddressKey(k.email))).toBe(
			RESET_REQUESTS_PER_ADDRESS.limit + 1,
		);
		expect(
			await adminDb.apiRateLimit.count({
				where: { key: { contains: k.email } },
			}),
		).toBe(0);
	});

	it("answers 429 with Retry-After on the 6th request of a minute from one sender", async () => {
		stayInWindow(MINUTE, 12_000);
		const sender = { ip: "192.0.2.131" };
		for (let i = 0; i < 5; i++)
			expect((await request(stranger(), sender)).status).toBe(200);
		const refused = await request(stranger(), sender);
		await expectProblem(refused, 429, "rate_limited");
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		expect((await request(stranger())).status).toBe(200);
	});

	it("is a conflict whatever the address when the server cannot send email", async () => {
		const k = await recoverable();
		delivery.on = false;
		for (const email of [k.email, stranger()])
			await expectProblem(await request(email), 409, "conflict");
		expect(await codeRows(k.id)).toHaveLength(0);
	});

	it("keeps an earlier live code working when another is asked for", async () => {
		const k = await recoverable();
		await request(k.email);
		const first = mailedCode(0).replace("-", "");
		await request(k.email);
		const second = mailedCode(1).replace("-", "");
		expect(second).not.toBe(first);
		expect(await codeRows(k.id)).toHaveLength(2);
		expect((await redeem(k.email, first)).status).toBe(200);
	});

	it("ignores a session, an Idempotency-Key and the cookie's user: it acts on the address only", async () => {
		const victim = await recoverable();
		const bystander = await recoverable();
		const cookie = await webCookieFor(bystander.id);
		spies.keyring.mockClear();
		spies.zone.mockClear();
		await request(victim.email, {
			headers: { ...cookie, "idempotency-key": `req-${victim.id}` },
		});
		expect(await codeRows(victim.id)).toHaveLength(1);
		expect(await codeRows(bystander.id)).toHaveLength(0);
		expect(mail.sendEmail.mock.calls.map((c) => c[0])).toEqual([victim.email]);
		for (const id of [victim.id, bystander.id]) {
			expect(await adminDb.idempotencyKey.count({ where: { userId: id } })).toBe(
				0,
			);
			expect(await adminDb.apiEvent.count({ where: { userId: id } })).toBe(0);
		}
		expect(spies.keyring).not.toHaveBeenCalled();
		expect(spies.zone).not.toHaveBeenCalled();
	});

	it("refuses a malformed body", async () => {
		await expectProblem(
			await send("/auth/password-reset", {}),
			400,
			"validation_failed",
		);
		await expectProblem(
			await request("not-an-address"),
			400,
			"validation_failed",
		);
	});
});

describe("POST /auth/password-reset/code", () => {
	it("swaps the code for a recovery token that opens check, begin and the commit, with no Idempotency-Key", async () => {
		const k = await recoverable();
		const code = await codeFor(k);
		// Read the way a recovery key is: lower case, a hyphen and a space.
		const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase().replace("-", " - ");
		const body = await expectBody<{ token: string }>(
			await redeem(k.email, typed),
			routes.redeemResetCode,
		);
		expect(body.token).toMatch(/^[0-9a-f]{64}$/);

		const [phone, ...rest] = await phoneRows(k.id);
		expect(rest).toHaveLength(0);
		expect(phone?.token).toBe(hashToken(body.token));
		const life = (phone?.expires.getTime() ?? 0) - Date.now();
		expect(life).toBeGreaterThan(RESET_CODE_TTL_MS - 10_000);
		expect(life).toBeLessThanOrEqual(RESET_CODE_TTL_MS);

		expect(
			await expectBody(
				await recovery("/check", { token: body.token }),
				routes.checkRecovery,
			),
		).toEqual({ keys: "recovery", protectionOn: false });
		const begun = await expectBody<{ userId: string }>(
			await recovery("/begin", {
				token: body.token,
				recoveryAuthKey: k.recoveryAuthKey,
			}),
			routes.beginRecovery,
		);
		expect(begun.userId).toBe(k.id);
		const mine = commitBody(p, k, { token: body.token });
		const done = await expectBody<{ version: number }>(
			await recovery("", mine.input),
			routes.recover,
		);
		expect(done.version).toBe(2);
		// The code and the token are spent with the recovery: nothing is left.
		expect(
			await adminDb.passwordResetToken.count({ where: { userId: k.id } }),
		).toBe(0);
	});

	it("never opens the plain reset: the token and the code both get 404 and the password stays", async () => {
		const k = await recoverable();
		const code = await codeFor(k);
		const other = await codeFor(k);
		const { token } = await expectBody<{ token: string }>(
			await redeem(k.email, code),
			routes.redeemResetCode,
		);
		const before = await storedHash(k.id);

		for (const value of [token, code, other])
			await expect(plainReset(value)).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		expect(await storedHash(k.id)).toBe(before);
		// The token is still there for recovery, and the code row was not touched by the refusal.
		expect(await resolveRecoveryToken(token)).toEqual({ userId: k.id });
		// Each layer refuses it on its own: the lookup, the spend, and the
		// password writer that spends it (the router goes through the lookup first).
		expect(await lookupPlainResetToken(token)).toBeNull();
		await expect(
			spendResetToken(adminDb, {
				token,
				userId: k.id,
				origins: PLAIN_RESET_ORIGINS,
			}),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		await expect(
			resetPasswordHash({
				userId: k.id,
				hashed: "not-a-real-hash",
				by: { kind: "email" },
				token,
				whenNoCredential: "continue",
			}),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		expect(await storedHash(k.id)).toBe(before);
		expect(await phoneRows(k.id)).toHaveLength(1);
	});

	it("never reads a code's own row as a token, even when the row is keyed by a hash someone knows", async () => {
		const k = await recoverable();
		const known = "a-token-someone-holds";
		await adminDb.passwordResetToken.create({
			data: {
				token: hashToken(known),
				userId: k.id,
				origin: "code",
				codeHash: "digest",
				expires: new Date(Date.now() + HOUR),
			},
		});
		// Asked for outright, with a cast the types refuse: still no token.
		expect(await lookupResetToken(known, ["code"] as never)).toBeNull();
		expect(await resolveRecoveryToken(known)).toBeNull();
		await expectUnusable(await recovery("/check", { token: known }));
	});

	it("answers one 404 for an unknown address, a wrong, malformed, expired or used code, and another account's code", async () => {
		const k = await recoverable();
		const other = await recoverable();
		// Redeeming drops the account's other codes and making a code sweeps its
		// expired ones, so the used one goes first and the expired one last.
		const used = await codeFor(k);
		await redeem(k.email, used);
		const live = await codeFor(k);
		const expired = await codeFor(k, new Date(Date.now() - 2 * HOUR));
		const theirs = await codeFor(other);
		const answers = new Set<string>();
		const fresh = () =>
			adminDb.apiRateLimit.deleteMany({
				where: { key: `reset-code:user:${k.id}` },
			});
		for (const [email, code] of [
			[stranger(), live],
			[k.email, wrongCode(live)],
			[k.email, "short"],
			[k.email, "ÄÖÜÄÖÜÄÖ"],
			[k.email, "O".repeat(32)],
			[k.email, expired],
			[k.email, used],
			[k.email, theirs],
		] as const) {
			await fresh();
			const res = await redeem(email, code);
			expect(res.status).toBe(404);
			answers.add(await res.text());
		}
		expect(answers.size).toBe(1);
		expect(await phoneRows(k.id)).toHaveLength(1);
		// The live code was never spent by the wrong tries.
		expect((await codeRows(k.id)).length).toBeGreaterThan(0);
	});

	it("gives the 6th try of an hour a 429 across two codes, and the right code is refused too", async () => {
		stayInWindow(RESET_CODE_TRIES.windowMs);
		const k = await recoverable();
		const first = await codeFor(k);
		const second = await codeFor(k);
		for (let i = 0; i < 2; i++)
			await expectUnusable(await redeem(k.email, wrongCode(first)));
		// A new code in between adds no tries.
		const third = await codeFor(k);
		for (let i = 0; i < 3; i++)
			await expectUnusable(await redeem(k.email, wrongCode(second)));
		expect(await userTries(k.id)).toBe(RESET_CODE_TRIES.limit);
		const refused = await redeem(k.email, third);
		await expectProblem(refused, 429, "rate_limited");
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		// Nothing was spent: all three codes are still there and no token was made.
		expect(await codeRows(k.id)).toHaveLength(3);
		expect(await phoneRows(k.id)).toHaveLength(0);
		await expectProblem(await redeem(k.email, first), 429, "rate_limited");
	});

	it("counts an unknown address to the same limit, so the 429 says nothing about the account", async () => {
		stayInWindow(RESET_CODE_TRIES.windowMs);
		const email = stranger();
		for (let i = 0; i < RESET_CODE_TRIES.limit; i++)
			await expectUnusable(await redeem(email, wrongCode()));
		await expectProblem(await redeem(email, wrongCode()), 429, "rate_limited");
		expect(await triesOf(`reset-code:address:${keyedHash("resetAddress", email)}`)).toBe(
			RESET_CODE_TRIES.limit + 1,
		);
		expect(
			await adminDb.apiRateLimit.count({ where: { key: { contains: email } } }),
		).toBe(0);
	});

	it("spends the code once: two redeems at the same time give one token", async () => {
		const k = await recoverable();
		const code = await codeFor(k);
		const results = await Promise.all([
			redeem(k.email, code),
			redeem(k.email, code),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
		expect(await phoneRows(k.id)).toHaveLength(1);
		expect(await codeRows(k.id)).toHaveLength(0);
	});

	it("drops the account's other codes and earlier phone tokens when one is redeemed", async () => {
		const k = await recoverable();
		const a = await codeFor(k);
		const b = await codeFor(k);
		const first = await expectBody<{ token: string }>(
			await redeem(k.email, a),
			routes.redeemResetCode,
		);
		expect(await codeRows(k.id)).toHaveLength(0);
		await expectUnusable(await redeem(k.email, b));
		const c = await codeFor(k);
		const second = await expectBody<{ token: string }>(
			await redeem(k.email, c),
			routes.redeemResetCode,
		);
		expect(await resolveRecoveryToken(first.token)).toBeNull();
		expect(await resolveRecoveryToken(second.token)).toEqual({ userId: k.id });
		expect(await phoneRows(k.id)).toHaveLength(1);
		// The person's emailed link is not a code: it stays.
		expect(await resolveRecoveryToken(k.token)).toEqual({ userId: k.id });
	});

	it("binds a stored code to its own row: the same digest on another row opens nothing", async () => {
		const k = await recoverable();
		const code = await codeFor(k);
		const [row] = await codeRows(k.id);
		if (!row?.codeHash) throw new Error("no code row");
		await adminDb.passwordResetToken.deleteMany({ where: { token: row.token } });
		await adminDb.passwordResetToken.create({
			data: {
				token: randomBytes(16).toString("hex"),
				userId: k.id,
				origin: "code",
				codeHash: row.codeHash,
				expires: row.expires,
			},
		});
		await expectUnusable(await redeem(k.email, code));
	});

	it("lives 15 minutes: the code and the token it makes expire at the minute, by the clock the service is given", async () => {
		const k = await recoverable();
		const now = new Date();
		const code = await codeFor(k, now);
		const late = new Date(now.getTime() + RESET_CODE_TTL_MS);
		await expect(
			redeemResetCode({ email: k.email, code, now: late }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const token = await redeemResetCode({
			email: k.email,
			code,
			now: new Date(late.getTime() - 1),
		});
		const inside = new Date(late.getTime() - 1);
		// The token's own 15 minutes run from when the code was swapped.
		const expires = new Date(inside.getTime() + RESET_CODE_TTL_MS);
		expect(
			await resolveRecoveryToken(token, new Date(expires.getTime() - 1)),
		).toEqual({ userId: k.id });
		expect(await resolveRecoveryToken(token, expires)).toBeNull();
	});

	it("sweeps the account's expired codes and links when it makes a new code", async () => {
		const k = await recoverable();
		const past = new Date(Date.now() - 2 * HOUR);
		await codeFor(k, past);
		await issueLinkFor(k.id, "email", past);
		expect(await codeRows(k.id)).toHaveLength(1);
		await codeFor(k);
		// Only the new code and the account's live link (made by `recoverable`) remain.
		expect(await codeRows(k.id)).toHaveLength(1);
		expect(
			await adminDb.passwordResetToken.count({
				where: { userId: k.id, expires: { lte: new Date() } },
			}),
		).toBe(0);
	});

	it("makes no code for an address that changed after it was read", async () => {
		const k = await recoverable();
		expect(
			await issueResetCode({ userId: k.id, forEmail: `old-${k.email}` }),
		).toBeNull();
		expect(await codeRows(k.id)).toHaveLength(0);
	});

	it("acts on the code's account only, with another account's cookie or bearer", async () => {
		const victim = await recoverable();
		const bystander = await recoverable();
		const cookie = await webCookieFor(bystander.id);
		const bearer = { authorization: `Bearer ${await sessionFor(bystander.id)}` };
		const code = await codeFor(victim);
		spies.keyring.mockClear();
		spies.zone.mockClear();

		const { token } = await expectBody<{ token: string }>(
			await redeem(victim.email, code, {
				headers: { ...cookie, "idempotency-key": `redeem-${victim.id}` },
			}),
			routes.redeemResetCode,
		);
		expect(await resolveRecoveryToken(token)).toEqual({ userId: victim.id });
		expect(await phoneRows(victim.id)).toHaveLength(1);
		expect(await phoneRows(bystander.id)).toHaveLength(0);
		expect(await userTries(victim.id)).toBe(1);
		expect(await userTries(bystander.id)).toBe(0);
		// The bearer reads no differently from the cookie, and a wrong code under
		// the cookie counts against the address it names, not the cookie's user.
		await expectUnusable(
			await redeem(victim.email, wrongCode(code), { headers: bearer }),
		);
		expect(await userTries(victim.id)).toBe(2);
		expect(await userTries(bystander.id)).toBe(0);

		for (const id of [victim.id, bystander.id]) {
			expect(await adminDb.idempotencyKey.count({ where: { userId: id } })).toBe(
				0,
			);
			expect(await adminDb.apiEvent.count({ where: { userId: id } })).toBe(0);
		}
		expect(spies.keyring).not.toHaveBeenCalled();
		expect(spies.zone).not.toHaveBeenCalled();
		// The token opens the victim's recovery even when the caller holds the
		// bystander's cookie.
		const begun = await expectBody<{ userId: string }>(
			await recovery(
				"/begin",
				{ token, recoveryAuthKey: victim.recoveryAuthKey },
				{ headers: cookie },
			),
			routes.beginRecovery,
		);
		expect(begun.userId).toBe(victim.id);
	});

	it("shares the recovery sender bucket: the 11th request of one sender in a minute is 429", async () => {
		stayInWindow(MINUTE, 12_000);
		const sender = { ip: "192.0.2.141" };
		const email = stranger();
		for (let i = 0; i < 4; i++)
			await expectUnusable(await redeem(email, wrongCode(), sender));
		for (let i = 0; i < 6; i++)
			await expectUnusable(
				await recovery("/check", { token: wrongCode() }, sender),
			);
		await expectProblem(
			await redeem(stranger(), wrongCode(), sender),
			429,
			"rate_limited",
		);
	}, 60_000);
});
