/**
 * Every writer of the password hash on Postgres, for an account with and
 * without protection keys (E2EE K1): the person's own change, the email reset,
 * the admin reset and its link, the reset request, and better-auth's own
 * password routes. Each takes the credential row lock and reads the key set
 * under it, so a writer that waits behind a turn-on sees the keys.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { problemCode } from "~/server/api/error-formatter";
import { adminRouter } from "~/server/api/routers/admin";
import { authRouter } from "~/server/api/routers/auth";
import { createCallerFactory } from "~/server/api/trpc";
import {
	sessionFor,
	webCookieFor,
} from "~/server/api/v1/core/__tests__/harness";
import { auth } from "~/server/better-auth";
import { changeOwnPassword } from "~/server/services/account-security.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { lockCredential, ProtectedPasswordError } from "./password-writes";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("~/server/mailer", () => mail);
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => true,
}));

const PASSWORD = "Correct horse 1";
const NEW_PASSWORD = "Battery staple 2";

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

/** The stored hash is of a derived sign-in secret, never of the typed password. */
async function giveKeys(userId: string, state: "OFF" | "ON" = "OFF") {
	const wrapped = new Uint8Array(74);
	wrapped[0] = 1;
	wrapped[1] = 1;
	await adminDb.protectionKeySet.create({
		data: {
			userId,
			kdfSalt: new Uint8Array(16).fill(1),
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: new Uint8Array(32).fill(2),
		},
	});
	await adminDb.protectionKeyWrap.create({
		data: { userId, role: "ak-password", targetId: userId, wrapped },
	});
	await adminDb.account.updateMany({
		where: { userId, providerId: "credential" },
		data: { password: await hashPassword("derived-sign-in-secret") },
	});
	if (state === "ON")
		await adminDb.user.update({
			where: { id: userId },
			data: { protectionState: "ON" },
		});
}

const keyRows = async (userId: string) => ({
	sets: await adminDb.protectionKeySet.count({ where: { userId } }),
	wraps: await adminDb.protectionKeyWrap.count({ where: { userId } }),
});

/**
 * Stands in for K1-2's enable: its own owner transaction takes the credential
 * lock, creates a key set and stays open until released. A writer that does not
 * take the lock would finish before it commits.
 */
async function enableInFlight(userId: string) {
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
			await tx.protectionKeySet.create({
				data: {
					userId,
					kdfSalt: new Uint8Array(16).fill(1),
					kdfMemoryKiB: 65536,
					kdfPasses: 3,
					publicKey: new Uint8Array(32).fill(2),
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
			await open;
		},
	};
}

/**
 * Starts a call and waits until it is blocked on a row lock (Postgres says so
 * in pg_stat_activity) or has finished, so the test commits the turn-on only
 * once the writer is really waiting behind it, however long its password hash
 * took. `blocked` is false when the writer finished without waiting.
 */
async function blockedBehindLock<T>(call: Promise<T>) {
	const outcome = call.then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);
	let done = false;
	void outcome.then(() => {
		done = true;
	});
	const deadline = Date.now() + 15_000;
	while (!done && Date.now() < deadline) {
		const [row] = await adminDb.$queryRaw<{ waiting: number }[]>`
			SELECT count(*)::int AS waiting FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'`;
		if ((row?.waiting ?? 0) > 0) return { blocked: true, outcome };
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return { blocked: false, outcome };
}

let n = 0;
const headers = () =>
	new Headers({ "x-forwarded-for": `203.0.113.${10 + (n++ % 200)}` });
const publicCaller = () =>
	createCallerFactory(authRouter)({
		session: null,
		db: adminDb,
		headers: headers(),
	} as never);

async function adminCaller() {
	const admin = await createTestUser({ role: "ADMIN" });
	const caller = createCallerFactory(adminRouter)({
		session: makeSession({ id: admin.user.id, role: "ADMIN" }),
		db: adminDb,
		headers: new Headers(),
	} as never);
	return { caller, adminId: admin.user.id };
}

async function resetToken(email: string) {
	const token = randomBytes(16).toString("hex");
	await adminDb.passwordResetToken.create({
		data: { identifier: email, token, expires: new Date(Date.now() + 60_000) },
	});
	return token;
}

// The rollback test of the key tables needs them empty, and a worker's database
// outlives the file: leave no key rows behind.
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

beforeEach(() => mail.sendEmail.mockClear());

describe("changeOwnPassword", () => {
	const change = (a: Account, keep = "keep") =>
		changeOwnPassword({
			userId: a.id,
			keepSessionId: keep,
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
		});

	it("changes the password of an account without keys, as before", async () => {
		const a = await passwordUser();
		await sessionFor(a.id);
		const result = await change(a);
		expect(result.signedOut).toBeGreaterThanOrEqual(1);
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
	});

	it("refuses an account with keys with protected_password, not 'incorrect', and changes nothing", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		const other = await sessionFor(a.id);
		const before = await storedHash(a.id);
		const error = await change(a).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProtectedPasswordError);
		expect(problemCode(error as ProtectedPasswordError)).toBe(
			"protected_password",
		);
		expect(await storedHash(a.id)).toBe(before);
		expect(await adminDb.session.count({ where: { token: other } })).toBe(1);
	});

	it("waits behind a turn-on in flight and then refuses", async () => {
		const a = await passwordUser();
		const before = await storedHash(a.id);
		const enable = await enableInFlight(a.id);
		const { blocked, outcome } = await blockedBehindLock(change(a));
		expect(blocked).toBe(true);
		await enable.commit();
		expect(await outcome).toMatchObject({
			error: expect.any(ProtectedPasswordError),
		});
		expect(await storedHash(a.id)).toBe(before);
	});
});

describe("auth.resetPassword (email reset)", () => {
	const reset = (token: string) =>
		publicCaller().resetPassword({ token, newPassword: NEW_PASSWORD });

	it("resets an account without keys, as before, and ends its sessions and the token", async () => {
		const a = await passwordUser();
		const session = await sessionFor(a.id);
		const token = await resetToken(a.email);
		await reset(token);
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
		expect(await adminDb.session.count({ where: { token: session } })).toBe(0);
		expect(await adminDb.passwordResetToken.count({ where: { token } })).toBe(
			0,
		);
	});

	it("removes the keys of an account whose protection is OFF with the new hash, and records ids only", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		await reset(await resetToken(a.email));
		expect(await keyRows(a.id)).toEqual({ sets: 0, wraps: 0 });
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
		const events = await adminDb.eventLog.findMany({
			where: { userId: a.id, eventType: "PASSWORD_RESET" },
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.metadata).toEqual({
			reason: "protection_keys_removed",
			action: "email_reset",
		});
		expect(JSON.stringify(events[0])).not.toContain(a.email);
	});

	it("refuses an account whose protection is on, and changes nothing", async () => {
		const a = await passwordUser();
		await giveKeys(a.id, "ON");
		const session = await sessionFor(a.id);
		const token = await resetToken(a.email);
		const before = await storedHash(a.id);
		const error = await reset(token).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProtectedPasswordError);
		expect(await storedHash(a.id)).toBe(before);
		expect(await keyRows(a.id)).toEqual({ sets: 1, wraps: 1 });
		expect(await adminDb.session.count({ where: { token: session } })).toBe(1);
		expect(await adminDb.passwordResetToken.count({ where: { token } })).toBe(
			1,
		);
	});

	it("waits behind a turn-on in flight, then removes the keys it created", async () => {
		const a = await passwordUser();
		const token = await resetToken(a.email);
		const enable = await enableInFlight(a.id);
		const { blocked, outcome } = await blockedBehindLock(reset(token));
		expect(blocked).toBe(true);
		await enable.commit();
		expect(await outcome).toMatchObject({ value: { success: true } });
		expect(await keyRows(a.id)).toEqual({ sets: 0, wraps: 0 });
	});
});

describe("auth.requestPasswordReset", () => {
	const request = (email: string) =>
		publicCaller().requestPasswordReset({ email });

	it("sends a link to an account without keys", async () => {
		const a = await passwordUser();
		mail.sendEmail.mockClear(); // sign-up sent its own verification mail
		expect(await request(a.email)).toEqual({ success: true });
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(
			await adminDb.passwordResetToken.count({
				where: { identifier: a.email },
			}),
		).toBe(1);
	});

	it("says the same for an account with keys and for no account, and sends nothing", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		mail.sendEmail.mockClear();
		expect(await request(a.email)).toEqual({ success: true });
		expect(await request(`nobody-${a.id}@pg-test.invalid`)).toEqual({
			success: true,
		});
		expect(mail.sendEmail).not.toHaveBeenCalled();
		expect(
			await adminDb.passwordResetToken.count({
				where: { identifier: a.email },
			}),
		).toBe(0);
	});
});

describe("admin.resetPassword and generatePasswordResetLink", () => {
	it("resets an account without keys, as before", async () => {
		const { caller: admin } = await adminCaller();
		const a = await passwordUser();
		const result = await admin.resetPassword({ userId: a.id });
		expect(
			await verifyPassword({
				password: result.newPassword,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
	});

	it("removes the keys of an account whose protection is OFF with the new hash, and records ids only", async () => {
		const { caller: admin, adminId } = await adminCaller();
		const a = await passwordUser();
		await giveKeys(a.id);
		const result = await admin.resetPassword({ userId: a.id });
		expect(await keyRows(a.id)).toEqual({ sets: 0, wraps: 0 });
		expect(
			await verifyPassword({
				password: result.newPassword,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
		const removal = (
			await adminDb.eventLog.findMany({
				where: { userId: a.id, eventType: "PASSWORD_RESET" },
			})
		).filter(
			(e) =>
				(e.metadata as { reason?: string } | null)?.reason ===
				"protection_keys_removed",
		);
		expect(removal).toHaveLength(1);
		expect(removal[0]?.metadata).toEqual({
			reason: "protection_keys_removed",
			action: "admin_reset",
			adminId,
		});
		expect(JSON.stringify(removal[0])).not.toContain(a.email);
	});

	it("refuses an account whose protection is on, and changes nothing", async () => {
		const { caller: admin } = await adminCaller();
		const a = await passwordUser();
		await giveKeys(a.id, "ON");
		const before = await storedHash(a.id);
		const error = await admin
			.resetPassword({ userId: a.id })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProtectedPasswordError);
		expect(await storedHash(a.id)).toBe(before);
		expect(await keyRows(a.id)).toEqual({ sets: 1, wraps: 1 });
	});

	it("waits behind a turn-on in flight, then removes the keys it created", async () => {
		const { caller: admin } = await adminCaller();
		const a = await passwordUser();
		const enable = await enableInFlight(a.id);
		const { blocked, outcome } = await blockedBehindLock(
			admin.resetPassword({ userId: a.id }),
		);
		expect(blocked).toBe(true);
		await enable.commit();
		await outcome;
		expect(await keyRows(a.id)).toEqual({ sets: 0, wraps: 0 });
	});

	it("still answers not found for an account with no credential", async () => {
		const { caller: admin } = await adminCaller();
		const { user } = await createTestUser();
		await expect(
			admin.resetPassword({ userId: user.id }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("makes a link for an account without keys and refuses one with keys before writing a token", async () => {
		const { caller: admin } = await adminCaller();
		const plain = await passwordUser();
		const keyed = await passwordUser();
		await giveKeys(keyed.id);
		const link = await admin.generatePasswordResetLink({ userId: plain.id });
		expect(link.resetUrl).toContain("/auth/reset-password?token=");
		expect(
			await adminDb.passwordResetToken.count({
				where: { identifier: plain.email },
			}),
		).toBe(1);
		await expect(
			admin.generatePasswordResetLink({ userId: keyed.id }),
		).rejects.toBeInstanceOf(ProtectedPasswordError);
		expect(
			await adminDb.passwordResetToken.count({
				where: { identifier: keyed.email },
			}),
		).toBe(0);
	});
});

describe("better-auth password routes", () => {
	it("refuses its own change-password, reset and reset request, and changes nothing", async () => {
		const a = await passwordUser();
		const before = await storedHash(a.id);
		const { cookie } = await webCookieFor(a.id);
		const post = (path: string, body: unknown) =>
			auth.handler(
				new Request(`http://localhost:3101/api/auth${path}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3101",
						cookie,
					},
					body: JSON.stringify(body),
				}),
			);
		const changed = await post("/change-password", {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
		});
		expect(changed.status).toBe(404);
		expect(
			(await post("/reset-password", { newPassword: NEW_PASSWORD, token: "x" }))
				.status,
		).toBe(404);
		expect(
			(await post("/request-password-reset", { email: a.email })).status,
		).toBe(404);
		expect(await storedHash(a.id)).toBe(before);
	});
});
