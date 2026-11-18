/**
 * Password reset links on Postgres (E2EE K3-0): what the table holds, who a
 * token opens, what ends it, and the request limit. The routes that reach the
 * service (auth.requestPasswordReset, auth.resetPassword, auth.confirmEmailChange,
 * admin.generatePasswordResetLink, the immediate email change) run as they do in
 * production; the pure service functions are called directly where the route
 * would hide the case. Expiry is driven by the `now` the service takes, never by
 * sleeping.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminRouter } from "~/server/api/routers/admin";
import { authRouter } from "~/server/api/routers/auth";
import { createCallerFactory } from "~/server/api/trpc";
import { auth } from "~/server/better-auth";
import { resetPasswordHash } from "~/server/services/account-security.service";
import {
	applyConfirmedEmail,
	updateProfile,
} from "~/server/services/profile.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { issueLinkFor } from "~/test/reset-links";
import { makeSession } from "~/test/trpc-test-utils";
import {
	allowResetRequest,
	deleteUserResetTokens,
	InvalidResetTokenError,
	issueResetToken,
	LIVE_ADMIN_LINKS,
	lockUserRow,
	resetAddressKey,
	lookupResetToken,
	RESET_LINK_TTL_MS,
	RESET_REQUESTS_PER_ADDRESS,
	resolveRecoveryToken,
	spendResetToken,
} from "./reset-tokens";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
const delivery = vi.hoisted(() => ({ on: true }));
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
vi.mock("~/server/mailer", () => mail);
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => delivery.on,
}));

const PASSWORD = "Correct horse 1";
const NEW_PASSWORD = "Battery staple 2";
const HOUR = RESET_LINK_TTL_MS;

type Account = { id: string; email: string };

async function passwordUser(): Promise<Account> {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	return { id: user.id, email };
}

const storedHash = async (userId: string) =>
	(
		await adminDb.account.findFirstOrThrow({
			where: { userId, providerId: "credential" },
		})
	).password ?? "";
const passwordIs = async (userId: string, password: string) =>
	verifyPassword({ password, hash: await storedHash(userId) });
const rows = (userId: string) =>
	adminDb.passwordResetToken.findMany({ where: { userId } });
const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

let n = 0;
const headers = () =>
	new Headers({ "x-forwarded-for": `198.51.100.${10 + (n++ % 200)}` });
const publicCaller = () =>
	createCallerFactory(authRouter)({
		session: null,
		db: adminDb,
		headers: headers(),
	} as never);
const request = (email: string) =>
	publicCaller().requestPasswordReset({ email });
const reset = (token: string, newPassword = NEW_PASSWORD) =>
	publicCaller().resetPassword({ token, newPassword });
async function adminCaller() {
	const admin = await createTestUser({ role: "ADMIN" });
	return createCallerFactory(adminRouter)({
		session: makeSession({ id: admin.user.id, role: "ADMIN" }),
		db: adminDb,
		headers: new Headers(),
	} as never);
}

/** The raw token a reset email carried: the table holds only its hash. */
const tokenInMail = (call = -1): string => {
	const html = String(
		(mail.sendEmail.mock.calls as unknown as string[][]).at(call)?.[2],
	);
	return /token=([0-9a-f]+)/.exec(html)?.[1] ?? "";
};

/** The request limit counts in fixed hours: a run near the edge waits it out. */
async function clearRequestWindowEdge(): Promise<void> {
	const { windowMs } = RESET_REQUESTS_PER_ADDRESS;
	const left = windowMs - (Date.now() % windowMs);
	if (left < 10_000) await new Promise((r) => setTimeout(r, left + 1_000));
}

beforeEach(() => {
	mail.sendEmail.mockClear();
	delivery.on = true;
	hashing.calls = 0;
});

describe("what the table holds", () => {
	it("stores the SHA-256 of the token and never the token", async () => {
		const { user } = await createTestUser();
		const token = await issueLinkFor(user.id, "email");
		const [row] = await rows(user.id);
		expect(row?.token).toBe(sha256(token));
		expect(row?.token).not.toBe(token);
		// A raw read of the column finds the hash too, whatever the model calls it.
		const raw = await adminDb.$queryRaw<{ token: string }[]>`
			SELECT "token" FROM "password_reset_token" WHERE "userId" = ${user.id}`;
		expect(raw.map((r) => r.token)).toEqual([sha256(token)]);
	});

	it("finds a token by its hash only: the stored value opens nothing", async () => {
		const { user } = await createTestUser();
		const token = await issueLinkFor(user.id, "email");
		const stored = sha256(token);
		expect(await lookupResetToken(token)).toEqual({
			userId: user.id,
			origin: "email",
		});
		expect(await lookupResetToken(stored)).toBeNull();
		await expect(
			spendResetToken(adminDb, { token: stored, userId: user.id }),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		expect(await rows(user.id)).toHaveLength(1);
	});

	it("is removed with the account", async () => {
		const { user } = await createTestUser();
		await issueLinkFor(user.id, "email");
		await adminDb.user.delete({ where: { id: user.id } });
		expect(await rows(user.id)).toHaveLength(0);
	});
});

describe("who a token opens", () => {
	it("resets the account it was made for after its address went to someone else", async () => {
		const a = await passwordUser();
		const b = await passwordUser();
		await request(a.email);
		const token = tokenInMail();
		// A moves away from the address; B takes it over. The old lookup went
		// through the address and would have reset B.
		const old = a.email;
		await adminDb.user.update({
			where: { id: a.id },
			data: { email: `moved-${old}` },
		});
		await adminDb.user.update({ where: { id: b.id }, data: { email: old } });
		const bBefore = await storedHash(b.id);

		const answer = await reset(token);
		expect(answer).toEqual({ success: true, email: `moved-${old}` });
		expect(await passwordIs(a.id, NEW_PASSWORD)).toBe(true);
		expect(await storedHash(b.id)).toBe(bBefore);
	});

	it("will not spend a token for another user, and keeps it", async () => {
		const a = await passwordUser();
		const b = await passwordUser();
		const token = await issueLinkFor(a.id, "email");
		const bBefore = await storedHash(b.id);
		const error = await resetPasswordHash({
			userId: b.id,
			hashed: await hashPassword(NEW_PASSWORD),
			by: { kind: "email" },
			token,
			whenNoCredential: "continue",
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(InvalidResetTokenError);
		expect(await storedHash(b.id)).toBe(bBefore);
		expect(await rows(a.id)).toHaveLength(1);
	});
});

describe("what ends a link", () => {
	it("is refused once it has expired, by the lookup and by the reset", async () => {
		const a = await passwordUser();
		const token = await issueLinkFor(
			a.id,
			"email",
			new Date(Date.now() - HOUR - 1_000),
		);
		expect(await lookupResetToken(token)).toBeNull();
		const before = await storedHash(a.id);
		await expect(reset(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await storedHash(a.id)).toBe(before);
	});

	it("is live up to its expiry and not at it", async () => {
		const { user } = await createTestUser();
		const issued = new Date(Date.now());
		const token = await issueLinkFor(user.id, "email", issued);
		const expires = issued.getTime() + HOUR;
		expect(await lookupResetToken(token, new Date(expires - 1))).not.toBeNull();
		expect(await lookupResetToken(token, new Date(expires))).toBeNull();
	});

	it("is refused by the spend itself once expired, and the row stays for the purge", async () => {
		const { user } = await createTestUser();
		const issued = new Date(Date.now());
		const token = await issueLinkFor(user.id, "email", issued);
		const at = new Date(issued.getTime() + HOUR);
		await expect(
			spendResetToken(adminDb, { token, userId: user.id, now: at }),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		expect(await rows(user.id)).toHaveLength(1);
		await spendResetToken(adminDb, {
			token,
			userId: user.id,
			now: new Date(at.getTime() - 1),
		});
		expect(await rows(user.id)).toHaveLength(0);
	});

	it("works once: a second use is refused and changes nothing", async () => {
		const a = await passwordUser();
		await request(a.email);
		const token = tokenInMail();
		await reset(token, NEW_PASSWORD);
		const after = await storedHash(a.id);
		await expect(reset(token, "Another pass 3")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(await storedHash(a.id)).toBe(after);
	});

	it("lets one of two concurrent uses win and refuses the other with nothing written", async () => {
		const a = await passwordUser();
		const token = await issueLinkFor(a.id, "email");
		const results = await Promise.allSettled([
			reset(token, "First pass 1"),
			reset(token, "Second pass 2"),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const lost = results.find((r) => r.status === "rejected");
		expect(lost).toMatchObject({ reason: { code: "NOT_FOUND" } });
		const winner = results.findIndex((r) => r.status === "fulfilled");
		expect(
			await passwordIs(a.id, winner === 0 ? "First pass 1" : "Second pass 2"),
		).toBe(true);
	});

	it("goes with every other link of the user when the password is reset", async () => {
		const a = await passwordUser();
		const first = await issueLinkFor(a.id, "email");
		const second = await issueLinkFor(a.id, "email");
		const admin = await issueLinkFor(a.id, "admin");
		await reset(first);
		expect(await rows(a.id)).toHaveLength(0);
		for (const token of [second, admin])
			await expect(reset(token, "Third pass 3")).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
	});

	it("is deleted by an address change, and only the user's own", async () => {
		const a = await passwordUser();
		const other = await passwordUser();
		const token = await issueLinkFor(a.id, "email");
		await issueLinkFor(other.id, "email");
		const confirm = `confirm-${randomUUID()}`;
		const next = `${randomUUID()}@pg-test.invalid`;
		await adminDb.user.update({
			where: { id: a.id },
			data: {
				pendingEmail: next,
				pendingEmailToken: sha256(confirm),
				pendingEmailExpiresAt: new Date(Date.now() + HOUR),
			},
		});
		await publicCaller().confirmEmailChange({ token: confirm });

		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: a.id } })).email,
		).toBe(next);
		expect(await rows(a.id)).toHaveLength(0);
		expect(await rows(other.id)).toHaveLength(1);
		await expect(reset(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("is deleted by the immediate address change that applies without email", async () => {
		const a = await passwordUser();
		await issueLinkFor(a.id, "email");
		delivery.on = false;
		const next = `${randomUUID()}@pg-test.invalid`;
		const result = await updateProfile(
			adminDb,
			{ id: a.id, username: "unused", email: a.email },
			{ email: next, currentPassword: PASSWORD },
			"session-for-the-try-counter",
		);
		expect(result.emailChangePending).toBe(false);
		expect(result.user.email).toBe(next);
		expect(await rows(a.id)).toHaveLength(0);
	});

	it("is not deleted by a profile change that keeps the address", async () => {
		const a = await passwordUser();
		await issueLinkFor(a.id, "email");
		delivery.on = false;
		await updateProfile(
			adminDb,
			{ id: a.id, username: "unused", email: a.email },
			{ name: "Lucía B" },
			"session-for-the-try-counter",
		);
		expect(await rows(a.id)).toHaveLength(1);
	});
});

describe("a new request", () => {
	it("keeps the link sent before it, so a stranger cannot cancel a reset in progress", async () => {
		const a = await passwordUser();
		await request(a.email);
		const first = tokenInMail();
		await request(a.email);
		const second = tokenInMail();
		expect(second).not.toBe(first);
		expect(await rows(a.id)).toHaveLength(2);
		expect(await lookupResetToken(first)).not.toBeNull();
		await reset(first);
		expect(await passwordIs(a.id, NEW_PASSWORD)).toBe(true);
	});

	it("keeps at most three live admin links and drops the oldest", async () => {
		const { user } = await createTestUser();
		const start = Date.now();
		const tokens: string[] = [];
		for (let i = 0; i < LIVE_ADMIN_LINKS + 1; i++)
			tokens.push(
				await issueLinkFor(user.id, "admin", new Date(start + i * 1_000)),
			);
		const live = await Promise.all(tokens.map((t) => lookupResetToken(t)));
		expect(live.map((l) => l !== null)).toEqual([false, true, true, true]);
		expect(await rows(user.id)).toHaveLength(LIVE_ADMIN_LINKS);
	});

	it("never trims the person's own links by count, and admin links never push them out", async () => {
		const { user } = await createTestUser();
		const start = Date.now();
		const mine: string[] = [];
		for (let i = 0; i < 6; i++)
			mine.push(
				await issueLinkFor(user.id, "email", new Date(start + i * 1_000)),
			);
		for (let i = 0; i < LIVE_ADMIN_LINKS + 2; i++)
			await issueLinkFor(user.id, "admin", new Date(start + i * 1_000));
		const live = await Promise.all(mine.map((t) => lookupResetToken(t)));
		expect(live.every((l) => l !== null)).toBe(true);
	});

	it("keeps a link made at 10:40 when a stranger fills the next request window at 11:00", async () => {
		const { user } = await createTestUser();
		const email = user.email;
		const hour = Math.floor(Date.now() / HOUR) * HOUR;
		const at = (minutes: number) => new Date(hour + minutes * 60_000);
		// The person's link, asked in the first window.
		expect(await allowResetRequest(email, at(40))).toBe(true);
		const mine = await issueLinkFor(user.id, "email", at(40));
		// The next window opens at 11:00: three more requests fit, and a fourth does not.
		const stranger: string[] = [];
		for (let i = 0; i < RESET_REQUESTS_PER_ADDRESS.limit; i++) {
			expect(await allowResetRequest(email, at(60 + i))).toBe(true);
			stranger.push(await issueLinkFor(user.id, "email", at(60 + i)));
		}
		expect(await allowResetRequest(email, at(63))).toBe(false);
		// 11:03 is inside the person's link (it ends at 11:40): it still opens.
		expect(await lookupResetToken(mine, at(63))).toEqual({
			userId: user.id,
			origin: "email",
		});
		expect(await rows(user.id)).toHaveLength(4);
		for (const t of stranger)
			expect(await lookupResetToken(t, at(63))).not.toBeNull();
	});

	it("sweeps the user's expired links when it makes a new one", async () => {
		const { user } = await createTestUser();
		await issueLinkFor(user.id, "email", new Date(Date.now() - 2 * HOUR));
		await issueLinkFor(user.id, "email");
		expect(await rows(user.id)).toHaveLength(1);
	});
});

describe("the per-address limit", () => {
	it("lets an address ask three times an hour, sends nothing for the fourth and answers alike", async () => {
		await clearRequestWindowEdge();
		const a = await passwordUser();
		mail.sendEmail.mockClear(); // sign-up sent its own verification mail
		for (let i = 0; i < RESET_REQUESTS_PER_ADDRESS.limit; i++)
			expect(await request(a.email)).toEqual({ success: true });
		const sent = mail.sendEmail.mock.calls.length;
		expect(sent).toBe(RESET_REQUESTS_PER_ADDRESS.limit);
		expect(await rows(a.id)).toHaveLength(RESET_REQUESTS_PER_ADDRESS.limit);

		expect(await request(a.email)).toEqual({ success: true });
		expect(mail.sendEmail.mock.calls.length).toBe(sent);
		expect(await rows(a.id)).toHaveLength(RESET_REQUESTS_PER_ADDRESS.limit);
	});

	it("counts the address after normalizing it, and apart from other addresses", async () => {
		const stamp = new Date(Math.floor(Date.now() / HOUR) * HOUR + HOUR / 2);
		const email = `${randomUUID()}@Pg-Test.invalid`;
		const spelled = [email, ` ${email.toLowerCase()} `, email.toUpperCase()];
		const answers = [];
		for (const s of [...spelled, email])
			answers.push(await allowResetRequest(s, stamp));
		expect(answers).toEqual([true, true, true, false]);
		expect(await allowResetRequest(`other-${email}`, stamp)).toBe(true);
	});

	it("keys the counter with a keyed hash, so a backup of the table does not say who asked", async () => {
		const email = `${randomUUID()}@pg-test.invalid`;
		await allowResetRequest(email);
		const key = resetAddressKey(email);
		expect(key).toMatch(/^reset:address:[0-9a-f]{64}$/);
		// Not the unkeyed hash of the address, which anyone could compute from a list.
		expect(key).not.toBe(`reset:address:${sha256(email.toLowerCase())}`);
		expect(key).not.toContain(email);
		expect(key).toBe(resetAddressKey(` ${email.toUpperCase()} `));
		expect(key).not.toBe(resetAddressKey(`other-${email}`));
		const stored = await adminDb.apiRateLimit.findMany({
			where: { key: { startsWith: "reset:address:" } },
			select: { key: true },
		});
		expect(stored.map((k) => k.key)).toContain(key);
		expect(stored.some((k) => k.key.includes(email))).toBe(false);
	});
});

describe("the request answers alike", () => {
	it("for a known address, an unknown one and an address over its limit", async () => {
		await clearRequestWindowEdge();
		const a = await passwordUser();
		mail.sendEmail.mockClear(); // sign-up sent its own verification mail
		const unknown = `nobody-${randomUUID()}@pg-test.invalid`;
		const hashesFor = async (email: string) => {
			hashing.calls = 0;
			const answer = await request(email);
			return {
				answer,
				hashes: hashing.calls,
				mails: mail.sendEmail.mock.calls.length,
			};
		};

		const known = await hashesFor(a.email);
		const gone = await hashesFor(unknown);
		expect(gone.answer).toEqual(known.answer);
		expect(known.mails).toBe(1);
		expect(gone.mails).toBe(1);
		expect(await adminDb.user.count({ where: { email: unknown } })).toBe(0);

		// Two more asks use up the known address; the refused one runs the same
		// single dummy hash as an unknown address.
		await request(a.email);
		await request(a.email);
		const refused = await hashesFor(a.email);
		expect(refused.answer).toEqual(gone.answer);
		expect(refused.hashes).toBe(gone.hashes);
		expect(refused.mails).toBe(3);
	});

	it("runs one password hash for a known, unknown, protected and used-up address alike", async () => {
		await clearRequestWindowEdge();
		const known = await passwordUser();
		const protectedAccount = await passwordUser();
		await adminDb.user.update({
			where: { id: protectedAccount.id },
			data: { protectionState: "ON" },
		});
		const limited = await passwordUser();
		for (let i = 0; i < RESET_REQUESTS_PER_ADDRESS.limit; i++)
			await allowResetRequest(limited.email);
		const unknown = `nobody-${randomUUID()}@pg-test.invalid`;
		for (const [kind, email] of [
			["known", known.email],
			["unknown", unknown],
			["protected", protectedAccount.email],
			["limited", limited.email],
		] as const) {
			hashing.calls = 0;
			expect(await request(email), kind).toEqual({ success: true });
			expect(hashing.calls, kind).toBe(1);
		}
	});

	it("does not wait on the mailer, and logs a failed send without the address", async () => {
		const a = await passwordUser();
		mail.sendEmail.mockClear();
		// A mail server that never answers: the request still returns.
		mail.sendEmail.mockImplementationOnce(
			() => new Promise<undefined>(() => {}),
		);
		expect(await request(a.email)).toEqual({ success: true });
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);

		const b = await passwordUser();
		mail.sendEmail.mockClear();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		mail.sendEmail.mockRejectedValueOnce(
			new Error(`550 no such mailbox ${b.email}`),
		);
		expect(await request(b.email)).toEqual({ success: true });
		await vi.waitFor(() => expect(logged).toHaveBeenCalled());
		// Errors stringify to "{}" in JSON, so read each argument as text and as an Error's message.
		const text = logged.mock.calls
			.flat()
			.map((arg) =>
				arg instanceof Error ? `${arg.message}${arg.stack}` : String(arg),
			)
			.join("\n");
		expect(text).not.toContain(b.email);
		logged.mockRestore();
	});

	it("leaves no link for an unknown address", async () => {
		const before = await adminDb.passwordResetToken.count();
		await request(`nobody-${randomUUID()}@pg-test.invalid`);
		expect(await adminDb.passwordResetToken.count()).toBe(before);
	});
});

describe("an address change and a new link", () => {
	/** What an address change does first, held open: the row lock and the new address, uncommitted. */
	async function changeInFlight(userId: string, next: string) {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let locked!: () => void;
		const hasLock = new Promise<void>((r) => (locked = r));
		const done = adminDb.$transaction(
			async (tx) => {
				await lockUserRow(tx, userId);
				await tx.user.update({ where: { id: userId }, data: { email: next } });
				locked();
				await gate;
				await deleteUserResetTokens(tx, userId);
			},
			{ timeout: 30_000 },
		);
		await hasLock;
		return {
			commit: async () => {
				release();
				await done;
			},
		};
	}
	/** What a link being made holds open: the row lock and the new link, uncommitted. */
	async function issueInFlight(userId: string) {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let locked!: () => void;
		const hasLock = new Promise<void>((r) => (locked = r));
		const done = adminDb.$transaction(
			async (tx) => {
				await lockUserRow(tx, userId);
				await tx.passwordResetToken.create({
					data: {
						token: sha256(randomUUID()),
						userId,
						origin: "email",
						expires: new Date(Date.now() + HOUR),
					},
				});
				locked();
				await gate;
			},
			{ timeout: 30_000 },
		);
		await hasLock;
		return {
			commit: async () => {
				release();
				await done;
			},
		};
	}
	const stillWaiting = async (work: Promise<unknown>) => {
		let settled = false;
		work.then(
			() => (settled = true),
			() => (settled = true),
		);
		await new Promise((r) => setTimeout(r, 400));
		return !settled;
	};

	it("waits behind an address change in flight, then makes no link for the address it left", async () => {
		const a = await passwordUser();
		const next = `${randomUUID()}@pg-test.invalid`;
		const change = await changeInFlight(a.id, next);
		const issuing = issueResetToken({
			userId: a.id,
			origin: "email",
			forEmail: a.email,
		});
		expect(await stillWaiting(issuing)).toBe(true);
		await change.commit();
		expect(await issuing).toBeNull();
		expect(await rows(a.id)).toHaveLength(0);
	});

	it("makes a link for the address the account has now, and none for the one it had", async () => {
		const a = await passwordUser();
		const next = `${randomUUID()}@pg-test.invalid`;
		await adminDb.user.update({ where: { id: a.id }, data: { email: next } });
		expect(
			await issueResetToken({
				userId: a.id,
				origin: "email",
				forEmail: a.email,
			}),
		).toBeNull();
		expect(await rows(a.id)).toHaveLength(0);
		expect(
			await issueResetToken({ userId: a.id, origin: "email", forEmail: next }),
		).not.toBeNull();
	});

	it("deletes a link that was being made when the confirmed address change arrived", async () => {
		const a = await passwordUser();
		const next = `${randomUUID()}@pg-test.invalid`;
		const issuing = await issueInFlight(a.id);
		const changing = applyConfirmedEmail(adminDb, a.id, a.email, next);
		expect(await stillWaiting(changing)).toBe(true);
		await issuing.commit();
		await changing;
		expect(await rows(a.id)).toHaveLength(0);
	});

	it("deletes a link that was being made when the immediate address change arrived", async () => {
		const a = await passwordUser();
		delivery.on = false;
		const next = `${randomUUID()}@pg-test.invalid`;
		const issuing = await issueInFlight(a.id);
		const changing = updateProfile(
			adminDb,
			{ id: a.id, username: "unused", email: a.email },
			{ email: next, currentPassword: PASSWORD },
			"session-for-the-try-counter",
		);
		expect(await stillWaiting(changing)).toBe(true);
		await issuing.commit();
		await changing;
		expect(await rows(a.id)).toHaveLength(0);
	});

	it("refuses an admin link for an address the account no longer has", async () => {
		const admin = await adminCaller();
		const a = await passwordUser();
		const next = `${randomUUID()}@pg-test.invalid`;
		const change = await changeInFlight(a.id, next);
		const making = admin.generatePasswordResetLink({ userId: a.id });
		// The procedure read the old address, then waits for the row lock.
		expect(await stillWaiting(making)).toBe(true);
		await change.commit();
		await expect(making).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await rows(a.id)).toHaveLength(0);
	});
});

describe("an admin link", () => {
	it("is made with origin admin, resets the password and never opens recovery", async () => {
		const admin = await adminCaller();
		const a = await passwordUser();
		const { resetUrl } = await admin.generatePasswordResetLink({
			userId: a.id,
		});
		const token = /token=([0-9a-f]+)/.exec(resetUrl)?.[1] ?? "";
		expect(token).not.toBe("");

		const [row] = await rows(a.id);
		expect(row).toMatchObject({ origin: "admin", token: sha256(token) });
		expect(await lookupResetToken(token)).toEqual({
			userId: a.id,
			origin: "admin",
		});
		// The check the recovery routes call (K3-2a): an admin link is no token.
		expect(await resolveRecoveryToken(token)).toBeNull();
		await expect(
			spendResetToken(adminDb, { token, userId: a.id, origin: "email" }),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		expect(await rows(a.id)).toHaveLength(1);

		// The plain reset still takes it, as before.
		await reset(token);
		expect(await passwordIs(a.id, NEW_PASSWORD)).toBe(true);
	});

	it("is not what a person's own request makes: that opens recovery for its user", async () => {
		const a = await passwordUser();
		await request(a.email);
		const token = tokenInMail();
		expect(await resolveRecoveryToken(token)).toEqual({ userId: a.id });
		expect(await resolveRecoveryToken("0".repeat(64))).toBeNull();
		const expired = await issueLinkFor(
			a.id,
			"email",
			new Date(Date.now() - 2 * HOUR),
		);
		expect(await resolveRecoveryToken(expired)).toBeNull();
	});

	it("is kept when the person asks for their own link", async () => {
		const admin = await adminCaller();
		const a = await passwordUser();
		const { resetUrl } = await admin.generatePasswordResetLink({
			userId: a.id,
		});
		const adminToken = /token=([0-9a-f]+)/.exec(resetUrl)?.[1] ?? "";
		await request(a.email);
		expect(await lookupResetToken(adminToken)).not.toBeNull();
		expect(await rows(a.id)).toHaveLength(2);
	});
});

describe("better-auth's own reset paths", () => {
	it("stay off, so no other writer of a reset exists", async () => {
		const a = await passwordUser();
		const before = await storedHash(a.id);
		const token = await issueLinkFor(a.id, "email");
		for (const [path, body] of [
			["/request-password-reset", { email: a.email }],
			["/reset-password", { newPassword: NEW_PASSWORD, token }],
		] as const) {
			const res = await auth.handler(
				new Request(`http://localhost:3101/api/auth${path}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3101",
					},
					body: JSON.stringify(body),
				}),
			);
			expect(res.status, path).toBe(404);
		}
		expect(await storedHash(a.id)).toBe(before);
		expect(await rows(a.id)).toHaveLength(1);
	});
});
