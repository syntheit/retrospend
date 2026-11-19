/**
 * Every writer of the password hash on Postgres, for an account with and
 * without protection keys (E2EE K1): the person's own change, the email reset,
 * the admin reset and its link, the reset request, and better-auth's own
 * password routes. Each takes the credential row lock and reads the key set
 * under it, so a writer that waits behind a turn-on sees the keys.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { problemCode } from "~/server/api/error-formatter";
import { adminRouter } from "~/server/api/routers/admin";
import { authRouter } from "~/server/api/routers/auth";
import { userRouter } from "~/server/api/routers/user";
import { createCallerFactory } from "~/server/api/trpc";
import {
	call,
	expectProblem,
	sessionFor,
	webCookieFor,
} from "~/server/api/v1/core/__tests__/harness";
import { auth } from "~/server/better-auth";
import {
	changeOwnPassword,
	PasswordTriesExceededError,
	spendPasswordTry,
} from "~/server/services/account-security.service";
import { issueLinkFor } from "~/test/reset-links";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { REPO_ROOT } from "~/test/uiRules/paths";
import {
	lockCredential,
	ProtectedPasswordError,
	SWAP_WRITERS,
	type SwapWriter,
	swapCredentialHash,
} from "./password-writes";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined) }));
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

const TRIES_WINDOW_MS = 15 * 60_000;
/** The tries count in fixed 15 minute windows: a run near the edge waits it out. */
async function clearTriesWindowEdge(): Promise<void> {
	const left = TRIES_WINDOW_MS - (Date.now() % TRIES_WINDOW_MS);
	if (left < 60_000) await new Promise((r) => setTimeout(r, left + 1_000));
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

const resetToken = (userId: string, origin: "email" | "admin" = "email") =>
	issueLinkFor(userId, origin);

/** The raw token the reset email carried: the table holds only its hash. */
const tokenInMail = (call = -1): string => {
	const html = String((mail.sendEmail.mock.calls as unknown as string[][]).at(call)?.[2]);
	return /token=([0-9a-f]+)/.exec(html)?.[1] ?? "";
};
const tokenRows = (userId: string) =>
	adminDb.passwordResetToken.count({ where: { userId } });

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

	it("takes the hash it verified: a hash another writer stored while it waited is not overwritten", async () => {
		const a = await passwordUser();
		const other = await sessionFor(a.id);
		const taken = await hashPassword("A reset password 3");
		// A keyless reset commits between the verify and the write: the key set
		// is still absent, so only the compare-and-swap can see what changed.
		const holder = await holdCredentialLock(a.id, async (tx) => {
			await tx.account.updateMany({
				where: { userId: a.id, providerId: "credential" },
				data: { password: taken },
			});
		});
		const { blocked, outcome } = await blockedBehindLock(change(a));
		expect(blocked).toBe(true);
		await holder.commit();
		expect(await outcome).toMatchObject({
			error: expect.objectContaining({ code: "CONFLICT" }),
		});
		expect(await storedHash(a.id)).toBe(taken);
		expect(await adminDb.session.count({ where: { token: other } })).toBe(1);
	});

	it("refuses a keyed account without spending a try: the sixth call still says protected_password", async () => {
		await clearTriesWindowEdge();
		const a = await passwordUser();
		await giveKeys(a.id);
		const session = randomUUID();
		for (let i = 0; i < 6; i++) {
			const error = await change(a, session).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(ProtectedPasswordError);
		}
	}, 120_000);

	it("spends a try on every call of a keyless account, so the sixth from one session is refused", async () => {
		await clearTriesWindowEdge();
		const a = await passwordUser();
		const session = randomUUID();
		const wrong = () =>
			changeOwnPassword({
				userId: a.id,
				keepSessionId: session,
				currentPassword: "Not mine 1",
				newPassword: NEW_PASSWORD,
			});
		for (let i = 0; i < 5; i++)
			await expect(wrong()).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(change(a, session)).rejects.toBeInstanceOf(
			PasswordTriesExceededError,
		);
	}, 120_000);
});

describe("swapCredentialHash", () => {
	const swap = async (
		a: Account,
		over: Partial<Parameters<typeof swapCredentialHash>[1]> = {},
	) => {
		const checked = await storedHash(a.id);
		const hashed = await hashPassword("A new hash 4");
		const result = await adminDb.$transaction((tx) =>
			swapCredentialHash(tx, {
				writer: "change",
				userId: a.id,
				checked,
				hashed,
				sessions: { keep: "keep" },
				...over,
			}),
		);
		return { result, checked, hashed };
	};

	it("replaces the checked hash, ends the other sessions and the reset links of the user when asked", async () => {
		const a = await passwordUser();
		const other = await sessionFor(a.id);
		await resetToken(a.id);
		const { result, hashed } = await swap(a, { dropResetLinks: true });
		expect(result).toMatchObject({ ok: true });
		expect(await storedHash(a.id)).toBe(hashed);
		expect(await adminDb.session.count({ where: { token: other } })).toBe(0);
		expect(await tokenRows(a.id)).toBe(0);
	});

	it("leaves reset links alone when not asked", async () => {
		const a = await passwordUser();
		await resetToken(a.id);
		await swap(a);
		expect(await tokenRows(a.id)).toBe(1);
	});

	it("refuses a hash that is no longer the one checked, and writes nothing", async () => {
		const a = await passwordUser();
		const other = await sessionFor(a.id);
		const stored = await storedHash(a.id);
		const { result } = await swap(a, {
			checked: await hashPassword("What was checked once"),
		});
		expect(result).toEqual({ ok: false, refusal: "hash_changed" });
		expect(await storedHash(a.id)).toBe(stored);
		expect(await adminDb.session.count({ where: { token: other } })).toBe(1);
	});

	it("refuses a keyed account when keys must be absent, and a keyless one when they must be present", async () => {
		const keyless = await passwordUser();
		expect((await swap(keyless, { writer: "rotate" })).result).toEqual({
			ok: false,
			refusal: "keys_missing",
		});
		const keyed = await passwordUser();
		await giveKeys(keyed.id);
		const before = await storedHash(keyed.id);
		expect((await swap(keyed, { writer: "change" })).result).toEqual({
			ok: false,
			refusal: "keys_present",
		});
		expect(await storedHash(keyed.id)).toBe(before);
		expect((await swap(keyed, { writer: "rotate" })).result).toMatchObject({
			ok: true,
		});
	});

	it("refuses an account with no credential", async () => {
		const { user } = await createTestUser();
		const result = await adminDb.$transaction((tx) =>
			swapCredentialHash(tx, {
				writer: "change",
				userId: user.id,
				checked: "x",
				hashed: "y",
				sessions: { keep: "keep" },
			}),
		);
		expect(result).toEqual({ ok: false, refusal: "no_credential" });
	});
});

/**
 * Where each hash writer is driven through its own caller, one case per member
 * of the union (a `Record`, so a writer added without a case fails typecheck).
 * The change goes through changeOwnPassword in this file.
 */
const SWAP_DRIVEN_BY: Record<SwapWriter, { file: string }> = {
	change: { file: "src/server/services/protection-keys/password-writes.pg.test.ts" },
	enable: { file: "src/server/services/protection-keys/enable.pg.test.ts" },
	rotate: { file: "src/server/services/protection-keys/rotate.pg.test.ts" },
	recovery: { file: "src/server/services/protection-keys/recover.pg.test.ts" },
};

describe("the hash writer union", () => {
	it("is the plan's writer table, and every member has a test that drives it", () => {
		const plan = ["change", "enable", "rotate", "recovery"];
		expect([...SWAP_WRITERS].sort()).toEqual([...plan].sort());
		expect(Object.keys(SWAP_DRIVEN_BY).sort()).toEqual([...plan].sort());
		for (const driven of Object.values(SWAP_DRIVEN_BY))
			expect(existsSync(join(REPO_ROOT, driven.file)), driven.file).toBe(true);
	});

	const swapAs = async (
		a: Account,
		writer: SwapWriter,
		sessions: Parameters<typeof swapCredentialHash>[1]["sessions"],
	) => {
		const checked = await storedHash(a.id);
		const hashed = await hashPassword("A new hash 5");
		const result = await adminDb
			.$transaction((tx) =>
				swapCredentialHash(tx, {
					writer,
					userId: a.id,
					checked,
					hashed,
					sessions,
				}),
			)
			.then(
				(r) => r,
				(e: unknown) => e,
			);
		return { result, checked, hashed };
	};

	it("recovery ends every session, the others keep the caller's", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		await adminDb.session.deleteMany({ where: { userId: a.id } });
		const mine = await sessionFor(a.id);
		const mineId = (await adminDb.session.findUniqueOrThrow({ where: { token: mine } })).id;
		await sessionFor(a.id);
		const rotated = await swapAs(a, "rotate", { keep: mineId });
		expect(rotated.result).toEqual({ ok: true, signedOut: 1 });
		expect(await adminDb.session.count({ where: { userId: a.id } })).toBe(1);
		await sessionFor(a.id);
		const recovered = await swapAs(a, "recovery", { endAll: true });
		expect(recovered.result).toEqual({ ok: true, signedOut: 2 });
		expect(await adminDb.session.count({ where: { userId: a.id } })).toBe(0);
	});

	it("refuses a session policy that does not fit the writer, before locking or writing", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		await adminDb.session.deleteMany({ where: { userId: a.id } });
		await sessionFor(a.id);
		const stored = await storedHash(a.id);
		for (const [writer, sessions] of [
			["recovery", { keep: "x" }],
			["rotate", { endAll: true }],
			["change", { endAll: true }],
			["enable", { endAll: true }],
		] as const) {
			const { result } = await swapAs(a, writer, sessions);
			expect(result, writer).toBeInstanceOf(Error);
		}
		expect(await storedHash(a.id)).toBe(stored);
		expect(await adminDb.session.count({ where: { userId: a.id } })).toBe(1);
	});

	it("refuses an unknown writer, including names every object has", async () => {
		const a = await passwordUser();
		for (const writer of ["admin", "constructor", "toString"]) {
			const { result } = await swapAs(a, writer as SwapWriter, { keep: "x" });
			expect(result, writer).toBeInstanceOf(Error);
		}
	});

	it("applies each writer's key rule: recovery and rotate need keys, change and enable need none", async () => {
		const keyless = await passwordUser();
		for (const writer of ["recovery", "rotate"] as const)
			expect(
				(await swapAs(keyless, writer, writer === "recovery" ? { endAll: true } : { keep: "k" })).result,
				writer,
			).toEqual({ ok: false, refusal: "keys_missing" });
		const keyed = await passwordUser();
		await giveKeys(keyed.id);
		for (const writer of ["change", "enable"] as const)
			expect((await swapAs(keyed, writer, { keep: "k" })).result, writer).toEqual({
				ok: false,
				refusal: "keys_present",
			});
	});
});

describe("auth.resetPassword (email reset)", () => {
	const reset = (token: string) =>
		publicCaller().resetPassword({ token, newPassword: NEW_PASSWORD });

	it("resets an account without keys, as before, and ends its sessions and the token", async () => {
		const a = await passwordUser();
		const session = await sessionFor(a.id);
		const token = await resetToken(a.id);
		await reset(token);
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
		expect(await adminDb.session.count({ where: { token: session } })).toBe(0);
		expect(await tokenRows(a.id)).toBe(0);
	});

	it("removes the keys of an account whose protection is OFF with the new hash, and records ids only", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		await reset(await resetToken(a.id));
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
		const token = await resetToken(a.id);
		const before = await storedHash(a.id);
		const error = await reset(token).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProtectedPasswordError);
		expect(await storedHash(a.id)).toBe(before);
		expect(await keyRows(a.id)).toEqual({ sets: 1, wraps: 1 });
		expect(await adminDb.session.count({ where: { token: session } })).toBe(1);
		expect(await tokenRows(a.id)).toBe(1);
	});

	it("waits behind a turn-on in flight, then removes the keys it created", async () => {
		const a = await passwordUser();
		const token = await resetToken(a.id);
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
		expect(await tokenRows(a.id)).toBe(1);
	});

	it("sends the normal link to an account with keys while protection is OFF, and the reset removes the keys", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		mail.sendEmail.mockClear();
		expect(await request(a.email)).toEqual({ success: true });
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		await publicCaller().resetPassword({
			token: tokenInMail(),
			newPassword: NEW_PASSWORD,
		});
		expect(await keyRows(a.id)).toEqual({ sets: 0, wraps: 0 });
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
	});

	it("spends one hash for an account whose protection is on, as it does for no account", async () => {
		const a = await passwordUser();
		await giveKeys(a.id, "ON");
		const hashesFor = async (email: string) => {
			hashing.calls = 0;
			await request(email);
			return hashing.calls;
		};
		const unknown = await hashesFor(`nobody-${a.id}@pg-test.invalid`);
		expect(unknown).toBe(1);
		expect(await hashesFor(a.email)).toBe(unknown);
	});

	it("sends nothing to an account whose protection is on, and answers like it does for no account", async () => {
		const a = await passwordUser();
		await giveKeys(a.id, "ON");
		mail.sendEmail.mockClear();
		const answer = await request(a.email);
		expect(answer).toEqual({ success: true });
		expect(await request(`nobody-${a.id}@pg-test.invalid`)).toEqual(answer);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		expect(await tokenRows(a.id)).toBe(0);
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

	it("makes a link for an account without keys or with keys while OFF, and refuses one whose protection is on before writing a token", async () => {
		const { caller: admin } = await adminCaller();
		const plain = await passwordUser();
		const keyedOff = await passwordUser();
		const keyedOn = await passwordUser();
		await giveKeys(keyedOff.id);
		await giveKeys(keyedOn.id, "ON");
		for (const who of [plain, keyedOff]) {
			const link = await admin.generatePasswordResetLink({ userId: who.id });
			expect(link.resetUrl).toContain("/auth/reset-password?token=");
			expect(
				await tokenRows(who.id),
			).toBe(1);
		}
		await expect(
			admin.generatePasswordResetLink({ userId: keyedOn.id }),
		).rejects.toBeInstanceOf(ProtectedPasswordError);
		expect(
			await tokenRows(keyedOn.id),
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

	it("does not route /verify-password: a check of the password that spends no try", async () => {
		const a = await passwordUser();
		const { cookie } = await webCookieFor(a.id);
		const res = await auth.handler(
			new Request("http://localhost:3101/api/auth/verify-password", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:3101",
					cookie,
				},
				body: JSON.stringify({ password: PASSWORD }),
			}),
		);
		expect(res.status).toBe(404);
	});
});

describe("better-auth two-factor routes that check the password", () => {
	/** A web session: its id, a cookie and a bearer for it. */
	async function webSession(userId: string) {
		const { cookie } = await webCookieFor(userId);
		const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0];
		const row = await adminDb.session.findFirstOrThrow({
			where: { token },
			select: { id: true },
		});
		return { id: row.id, cookie, bearer: `Bearer ${token}` };
	}
	const post = (
		path: string,
		extra: Record<string, string>,
		body: unknown = { password: "Not mine 1" },
	) =>
		auth.handler(
			new Request(`http://localhost:3101/api/auth${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:3101",
					...extra,
				},
				body: JSON.stringify(body),
			}),
		);
	// Written out, not read from the guard's own list: the routes of better-auth
	// that check a password and stay routed, found by searching its code for
	// checkPassword and validatePassword (plugins/two-factor).
	const PATHS = [
		"/two-factor/enable",
		"/two-factor/disable",
		"/two-factor/get-totp-uri",
		"/two-factor/generate-backup-codes",
	];

	it.each(PATHS)(
		"%s refuses once the session's five tries are used, and the route itself counts one",
		async (path) => {
			await clearTriesWindowEdge();
			const a = await passwordUser();
			const s = await webSession(a.id);
			for (let i = 0; i < 4; i++) await spendPasswordTry(a.id, s.id);
			// The fifth try is the route's own: a wrong password, answered 400.
			const fifth = await post(path, { cookie: s.cookie });
			expect(fifth.status).not.toBe(429);
			const sixth = await post(path, { cookie: s.cookie });
			expect(sixth.status).toBe(429);
			expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
		},
		120_000,
	);

	it("counts a call made with a bearer for a web session, not only one with the cookie", async () => {
		await clearTriesWindowEdge();
		const a = await passwordUser();
		const s = await webSession(a.id);
		for (let i = 0; i < 5; i++) await spendPasswordTry(a.id, s.id);
		const res = await post("/two-factor/get-totp-uri", {
			authorization: s.bearer,
		});
		expect(res.status).toBe(429);
	}, 120_000);

	it("charges the session better-auth authenticates, not a decoy under another cookie name", async () => {
		await clearTriesWindowEdge();
		// The decoy is made first, so an unordered lookup would find it first.
		const attacker = await passwordUser();
		const decoy = await webSession(attacker.id);
		const victim = await passwordUser();
		const stolen = await webSession(victim.id);
		for (let i = 0; i < 5; i++) await spendPasswordTry(victim.id, stolen.id);
		const decoyValue = decoy.cookie.split("=")[1];
		// better-auth reads only better-auth.session_token here; the other name is ignored.
		const res = await post("/two-factor/get-totp-uri", {
			cookie: `${stolen.cookie}; __Secure-better-auth.session_token=${decoyValue}`,
		});
		expect(res.status).toBe(429);
	}, 120_000);

	it("spends nothing for a call that carries no password, or no session", async () => {
		await clearTriesWindowEdge();
		const a = await passwordUser();
		const s = await webSession(a.id);
		for (let i = 0; i < 5; i++) await spendPasswordTry(a.id, s.id);
		const noPassword = await post(
			"/two-factor/generate-backup-codes",
			{ cookie: s.cookie },
			{},
		);
		expect(noPassword.status).not.toBe(429);
		const noSession = await post("/two-factor/enable", {});
		expect(noSession.status).not.toBe(429);
	}, 120_000);
});

describe("user.updateProfile with an email and a password change in one request", () => {
	it("counts one try for the request, not one for each check", async () => {
		await clearTriesWindowEdge();
		const a = await passwordUser();
		const caller = createCallerFactory(userRouter)({
			session: makeSession({
				id: a.id,
				email: a.email,
				username: "someone",
			}),
			db: adminDb,
			headers: new Headers(),
		} as never);
		for (let i = 0; i < 3; i++) await spendPasswordTry(a.id, "session-1");
		await caller.updateProfile({
			name: "Lucía",
			username: "someone",
			email: `${randomUUID()}@pg-test.invalid`,
			password: NEW_PASSWORD,
			currentPassword: PASSWORD,
		});
		// 3 before and 1 for the request leaves the fifth, and not the sixth.
		await spendPasswordTry(a.id, "session-1");
		await expect(spendPasswordTry(a.id, "session-1")).rejects.toBeInstanceOf(
			PasswordTriesExceededError,
		);
		expect(
			await verifyPassword({
				password: NEW_PASSWORD,
				hash: await storedHash(a.id),
			}),
		).toBe(true);
	}, 120_000);
});

describe("POST /api/v1/me/password", () => {
	it("answers 403 protected_password for an account with keys", async () => {
		const a = await passwordUser();
		await giveKeys(a.id);
		const res = await call("/me/password", {
			method: "POST",
			headers: {
				authorization: `Bearer ${await sessionFor(a.id)}`,
				"x-forwarded-for": "198.51.100.77",
			},
			body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
			idempotent: true,
		});
		await expectProblem(res, 403, "protected_password");
	});
});
