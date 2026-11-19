/**
 * The recovery service on Postgres (E2EE K3-2a): what a reset link and the
 * recovery key can do together, in the order the routes (K3-2b) will call it:
 * check, begin, commit. Fixtures follow production: the key set, its wraps and
 * the recovery hash are written together by the enable writer, the account's
 * hash is the hash of a sign-in secret, and the link comes from the real token
 * service. Route-level parts (the shared IP bucket, the 404 and 400 mapping,
 * the session being dropped) are K3-2b's.
 */
import { randomBytes } from "node:crypto";
import type { Recover } from "@retrospend/api-contract";
import {
	fromBase64Url,
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
import { sessionFor } from "~/server/api/v1/core/__tests__/harness";
import {
	RECOVERY_TRIES,
	RecoveryTriesExceededError,
} from "~/server/services/account-security.service";
import {
	deleteUserResetTokens,
	InvalidResetTokenError,
} from "~/server/services/auth/reset-tokens";
import { adminDb } from "~/test/pg-harness";
import { approvedDeviceCode, deviceCodeRows, pollDeviceCode } from "~/test/device-codes";
import { holdCredentialLock, holdSetLock } from "~/test/locks";
import { stayInWindow } from "~/test/rate-window";
import * as fixture from "~/test/recoverable";
import { issueLinkFor } from "~/test/reset-links";
import { ProtectionKeysError, ReleaseError } from "./errors";
import {
	beginRecovery,
	checkRecovery,
	commitRecovery,
} from "./recover";
import { settleKeysForReset } from "./password-writes";
import { applyKeyChanges } from "./protection-keys.service";
import { hashRecoveryProof } from "./validate";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
const mail = vi.hoisted(() => ({
	sendEmail: vi.fn(async (_to: string, _subject: string, _html: string) => {}),
}));
vi.mock("~/server/mailer", () => mail);
const delivery = vi.hoisted(() => ({ on: true }));
vi.mock("~/server/lib/email-delivery", () => ({
	isEmailDeliveryEnabled: async () => delivery.on,
}));

const HOUR = 60 * 60_000;

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});
beforeEach(() => {
	delivery.on = true;
	mail.sendEmail.mockClear();
});
afterAll(async () => {
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

const tokenHashOf = fixture.sha256;

// Sign-up sent its own verification mail; these tests count only their own.
async function passwordUser() {
	const user = await fixture.passwordUser();
	mail.sendEmail.mockClear();
	return user;
}
async function recoverable(opts: { state?: "OFF" | "ON" } = {}) {
	const k = await fixture.recoverable(opts);
	mail.sendEmail.mockClear();
	return k;
}
type Recoverable = fixture.Recoverable;
const commitBody = (k: Recoverable, over: Partial<Recover> = {}) =>
	fixture.commitBody(p, k, over);
const symmetric = (
	role: "ak-password" | "ak-recovery" | "private-key",
	userId: string,
) => ({
	role,
	targetId: userId,
	wrapped: wrapKey(p, p.randomBytes(32), role, userId, p.randomBytes(32)),
});

const wrongKey = () => signInSecret(p.randomBytes(32));
const settled = <T>(run: () => Promise<T>) =>
	run().then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);
const {
	seedApiKey,
	snapshot,
	storedHash,
	triesSpent,
	wrapBytes,
} = fixture;

describe("checkRecovery", () => {
	it("says what the link leads to, for each state of the account", async () => {
		const keyedOff = await recoverable();
		expect(await checkRecovery(keyedOff.token)).toEqual({
			keys: "recovery",
			protectionOn: false,
		});
		const keyedOn = await recoverable({ state: "ON" });
		expect(await checkRecovery(keyedOn.token)).toEqual({
			keys: "recovery",
			protectionOn: true,
		});
		const old = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: old.id },
			data: { recoveryHash: null },
		});
		expect((await checkRecovery(old.token)).keys).toBe("noRecovery");
		const plain = await passwordUser();
		expect(await checkRecovery(await issueLinkFor(plain.id))).toEqual({
			keys: "none",
			protectionOn: false,
		});
	});

	it("spends no try and shows no wrap, however often it is asked", async () => {
		const k = await recoverable();
		for (let i = 0; i < 12; i++) await checkRecovery(k.token);
		expect(await triesSpent(tokenHashOf(k.token))).toBe(0);
		expect(
			await adminDb.apiRateLimit.count({
				where: { key: { contains: k.id } },
			}),
		).toBe(0);
		// The tries are all still there.
		await beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey });
		expect(await triesSpent(tokenHashOf(k.token))).toBe(1);
	});

	it("is the one 404 for an unknown, expired or admin-made link, and for the stored value itself", async () => {
		const k = await recoverable();
		// The expired link is made last: making a link sweeps the person's expired ones.
		const admin = await issueLinkFor(k.id, "admin");
		const expired = await issueLinkFor(k.id, "email", new Date(Date.now() - 2 * HOUR));
		const stored = await adminDb.passwordResetToken.findFirstOrThrow({
			where: { userId: k.id, origin: "email", token: tokenHashOf(k.token) },
		});
		for (const token of [randomBytes(32).toString("hex"), expired, admin, stored.token])
			await expect(checkRecovery(token)).rejects.toBeInstanceOf(
				InvalidResetTokenError,
			);
	});
});

describe("beginRecovery", () => {
	it("gives the ak-recovery and private-key wraps and the public key, byte for byte, and no other wrap", async () => {
		const k = await recoverable();
		const got = await beginRecovery({
			token: k.token,
			recoveryAuthKey: k.recoveryAuthKey,
		});
		expect(got.userId).toBe(k.id);
		expect(got.version).toBe(1);
		expect(toBase64Url(got.publicKey)).toBe(toBase64Url(k.publicKey));
		// Listed by hand: a role added to the answer must be added here on purpose.
		expect(got.wraps.map((w) => w.role).sort()).toEqual([
			"ak-recovery",
			"private-key",
		]);
		for (const w of got.wraps) {
			const seeded = k.wraps.find((x) => x.role === w.role);
			expect(toBase64Url(w.wrapped)).toBe(toBase64Url(seeded?.wrapped ?? new Uint8Array()));
		}
		const text = JSON.stringify(got.wraps.map((w) => toBase64Url(w.wrapped)));
		for (const w of k.wraps.filter(
			(x) => !["ak-recovery", "private-key"].includes(x.role),
		))
			expect(text, w.role).not.toContain(toBase64Url(w.wrapped));
	});

	it("refuses a wrong proof with no wrap, and spends a try", async () => {
		const k = await recoverable();
		const before = await snapshot(k.id);
		const result = await settled(() =>
			beginRecovery({ token: k.token, recoveryAuthKey: wrongKey() }),
		);
		expect(result).toMatchObject({ error: { code: "wrong_proof" } });
		expect(result).not.toHaveProperty("value");
		expect(await triesSpent(tokenHashOf(k.token))).toBe(1);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("is a recovery_unavailable for a set without a recovery hash and no_keys for none, also spending a try", async () => {
		const old = await recoverable();
		await adminDb.protectionKeySet.update({
			where: { userId: old.id },
			data: { recoveryHash: null },
		});
		await expect(
			beginRecovery({ token: old.token, recoveryAuthKey: old.recoveryAuthKey }),
		).rejects.toMatchObject({ code: "recovery_unavailable" });
		const keyless = await passwordUser();
		const token = await issueLinkFor(keyless.id);
		await expect(
			beginRecovery({ token, recoveryAuthKey: wrongKey() }),
		).rejects.toMatchObject({ code: "no_keys" });
		expect(await triesSpent(tokenHashOf(token))).toBe(1);
	});

	it("checks the proof under the set lock: a hash changed while it waited is refused and no wrap leaves", async () => {
		const k = await recoverable();
		const newHash = hashRecoveryProof(wrongKey());
		const result = await holdSetLock(
			k.id,
			async (tx) => {
				await tx.protectionKeySet.update({
					where: { userId: k.id },
					select: { userId: true },
					data: { recoveryHash: Uint8Array.from(newHash) },
				});
			},
			() =>
				settled(() =>
					beginRecovery({
						token: k.token,
						recoveryAuthKey: k.recoveryAuthKey,
					}),
				),
		);
		expect(result).toMatchObject({ error: { code: "wrong_proof" } });
		expect(result).not.toHaveProperty("value");
	});

	it("refuses the account's own sign-in secret as the proof", async () => {
		const k = await recoverable();
		await expect(
			beginRecovery({ token: k.token, recoveryAuthKey: k.authKeyText }),
		).rejects.toMatchObject({ code: "wrong_proof" });
	});

	it("is 404 for an expired, admin-made or unknown link, before any try is spent", async () => {
		const k = await recoverable();
		// The expired link is made last: making a link sweeps the person's expired ones.
		const admin = await issueLinkFor(k.id, "admin");
		const expired = await issueLinkFor(k.id, "email", new Date(Date.now() - 2 * HOUR));
		for (const token of [expired, admin, randomBytes(32).toString("hex")]) {
			await expect(
				beginRecovery({ token, recoveryAuthKey: k.recoveryAuthKey }),
			).rejects.toBeInstanceOf(InvalidResetTokenError);
			expect(await triesSpent(tokenHashOf(token))).toBe(0);
		}
		expect(
			await adminDb.apiRateLimit.count({ where: { key: `recovery:user:${k.id}` } }),
		).toBe(0);
	});

	it("is wrong_proof for another user's link with this user's proof, and spends nothing of this user's", async () => {
		const a = await recoverable();
		const b = await recoverable();
		await expect(
			beginRecovery({ token: b.token, recoveryAuthKey: a.recoveryAuthKey }),
		).rejects.toMatchObject({ code: "wrong_proof" });
		expect(await triesSpent(tokenHashOf(a.token))).toBe(0);
	});

	it("is not a well-formed proof: refused before a try is spent", async () => {
		const k = await recoverable();
		await expect(
			beginRecovery({ token: k.token, recoveryAuthKey: "short" }),
		).rejects.toBeInstanceOf(ProtectionKeysError);
		expect(await triesSpent(tokenHashOf(k.token))).toBe(0);
	});

	it("stops the sixth try of one link, right proof included, and counts them for the user too", async () => {
		stayInWindow(RECOVERY_TRIES.windowMs);
		const k = await recoverable();
		for (let i = 0; i < RECOVERY_TRIES.perToken; i++)
			await settled(() =>
				beginRecovery({ token: k.token, recoveryAuthKey: wrongKey() }),
			);
		await expect(
			beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey }),
		).rejects.toBeInstanceOf(RecoveryTriesExceededError);
		const error = await settled(() =>
			beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey }),
		);
		expect((error as { error: RecoveryTriesExceededError }).error.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("shares the user's count across links: 10 an hour, however many links", async () => {
		stayInWindow(RECOVERY_TRIES.windowMs);
		const k = await recoverable();
		const second = await issueLinkFor(k.id);
		const third = await issueLinkFor(k.id);
		for (const token of [k.token, second])
			for (let i = 0; i < RECOVERY_TRIES.perToken; i++)
				await settled(() =>
					beginRecovery({ token, recoveryAuthKey: wrongKey() }),
				);
		// The third link has a try of its own left, but the user has none.
		expect(await triesSpent(tokenHashOf(third))).toBe(0);
		await expect(
			beginRecovery({ token: third, recoveryAuthKey: k.recoveryAuthKey }),
		).rejects.toBeInstanceOf(RecoveryTriesExceededError);
	});
});

describe("commitRecovery", () => {
	it("sets the new password and wrap, ends every session, drops links and API keys, and mails after the commit", async () => {
		const k = await recoverable();
		const sessions = [await sessionFor(k.id), await sessionFor(k.id)];
		const apiKey = await seedApiKey(k.id);
		await issueLinkFor(k.id);
		const before = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: k.id },
		});
		const body = commitBody(k);
		const done = await commitRecovery(body.input);
		expect(done).toEqual({ version: 2, signedOut: 2 });

		expect(
			await verifyPassword({
				password: body.newAuthKey,
				hash: await storedHash(k.id),
			}),
		).toBe(true);
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: k.id },
		});
		expect(set.version).toBe(2);
		expect(toBase64Url(set.kdfSalt)).toBe(toBase64Url(body.salt));
		expect(toBase64Url(set.publicKey)).toBe(toBase64Url(k.publicKey));
		// The recovery key still opens the set: its hash and wrap are untouched.
		expect(Buffer.from(set.recoveryHash ?? []).toString("hex")).toBe(
			Buffer.from(before.recoveryHash ?? []).toString("hex"),
		);
		expect(await wrapBytes(k.id, "ak-password")).toBe(toBase64Url(body.wrapped));
		for (const role of ["ak-recovery", "private-key"])
			expect(await wrapBytes(k.id, role), role).toBe(
				toBase64Url(k.wraps.find((w) => w.role === role)?.wrapped ?? new Uint8Array()),
			);
		expect(await adminDb.session.count({ where: { userId: k.id } })).toBe(0);
		for (const token of sessions)
			expect(await adminDb.session.count({ where: { token } })).toBe(0);
		expect(await adminDb.passwordResetToken.count({ where: { userId: k.id } })).toBe(0);
		expect(await adminDb.apikey.count({ where: { id: apiKey } })).toBe(0);
		// The audit entry carries ids and a reason, no text of the person's.
		const events = await adminDb.eventLog.findMany({
			where: { userId: k.id, eventType: "PASSWORD_CHANGED" },
		});
		expect(events.map((e) => e.metadata)).toEqual([
			{ reason: "protection_keys_recovered" },
		]);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(mail.sendEmail.mock.calls[0]?.[0]).toBe(k.email);
	});

	it("ends the approved device codes too: nothing polled afterwards gives a session", async () => {
		const k = await recoverable();
		const code = await approvedDeviceCode(k.id);
		const other = await recoverable();
		const otherCode = await approvedDeviceCode(other.id);
		await commitRecovery(commitBody(k).input);
		expect(await deviceCodeRows(k.id)).toBe(0);
		expect(await pollDeviceCode(code)).toBe("refused");
		// The poll path works, and another account's code is untouched.
		expect(await pollDeviceCode(otherCode)).toBe("session");
	});

	it("still succeeds when the mail cannot be sent", async () => {
		const k = await recoverable();
		mail.sendEmail.mockRejectedValueOnce(new Error("smtp down"));
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(commitRecovery(commitBody(k).input)).resolves.toMatchObject({
			version: 2,
		});
		spy.mockRestore();
	});

	it("works in every protection state, ON included", async () => {
		const k = await recoverable({ state: "ON" });
		await expect(commitRecovery(commitBody(k).input)).resolves.toMatchObject({
			version: 2,
		});
		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: k.id } })).protectionState,
		).toBe("ON");
	});

	it("does not trust begin: a wrong proof alone is refused and nothing changes", async () => {
		const k = await recoverable();
		await sessionFor(k.id);
		await seedApiKey(k.id);
		const before = await snapshot(k.id);
		await expect(
			commitRecovery(commitBody(k, { recoveryAuthKey: wrongKey() }).input),
		).rejects.toMatchObject({ code: "wrong_proof" });
		expect(await snapshot(k.id)).toBe(before);
		// The link is still good: a right proof works afterwards.
		await expect(commitRecovery(commitBody(k).input)).resolves.toMatchObject({
			version: 2,
		});
	});

	it("spends one try, as begin does: begin and commit use two of the five", async () => {
		const k = await recoverable();
		await beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey });
		expect(await triesSpent(tokenHashOf(k.token))).toBe(1);
		await commitRecovery(commitBody(k).input);
		expect(await triesSpent(tokenHashOf(k.token))).toBe(2);
	});

	it("refuses a wrong proof at the sixth try even when it is right then", async () => {
		stayInWindow(RECOVERY_TRIES.windowMs);
		const k = await recoverable();
		for (let i = 0; i < RECOVERY_TRIES.perToken; i++)
			await settled(() =>
				commitRecovery(commitBody(k, { recoveryAuthKey: wrongKey() }).input),
			);
		const before = await snapshot(k.id);
		await expect(commitRecovery(commitBody(k).input)).rejects.toBeInstanceOf(
			RecoveryTriesExceededError,
		);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("is 404 on a replay: the link was spent, and nothing is written twice", async () => {
		const k = await recoverable();
		await commitRecovery(commitBody(k).input);
		const after = await snapshot(k.id);
		await expect(commitRecovery(commitBody(k).input)).rejects.toBeInstanceOf(
			InvalidResetTokenError,
		);
		expect(await snapshot(k.id)).toBe(after);
	});

	it("lets one of two concurrent commits win and gives the other 404", async () => {
		const k = await recoverable();
		const [a, b] = [commitBody(k), commitBody(k)];
		const results = await Promise.all([
			settled(() => commitRecovery(a.input)),
			settled(() => commitRecovery(b.input)),
		]);
		const wins = results.filter((r) => "value" in r);
		const losses = results.filter((r) => "error" in r);
		expect(wins).toHaveLength(1);
		expect(losses).toHaveLength(1);
		expect((losses[0] as { error: unknown }).error).toBeInstanceOf(
			InvalidResetTokenError,
		);
		const winner = results[0] && "value" in results[0] ? a : b;
		expect(
			await verifyPassword({
				password: winner.newAuthKey,
				hash: await storedHash(k.id),
			}),
		).toBe(true);
		expect((await adminDb.protectionKeySet.findUniqueOrThrow({ where: { userId: k.id } })).version).toBe(2);
	});

	it("is wrong_proof for another user's link with this user's proof, and changes neither account", async () => {
		const a = await recoverable();
		const b = await recoverable();
		const [beforeA, beforeB] = [await snapshot(a.id), await snapshot(b.id)];
		await expect(
			commitRecovery(commitBody(b, { recoveryAuthKey: a.recoveryAuthKey }).input),
		).rejects.toMatchObject({ code: "wrong_proof" });
		expect(await snapshot(a.id)).toBe(beforeA);
		expect(await snapshot(b.id)).toBe(beforeB);
	});

	it("is 404 for an admin-made link, whatever the proof, and writes nothing", async () => {
		const k = await recoverable();
		const admin = await issueLinkFor(k.id, "admin");
		const before = await snapshot(k.id);
		await expect(
			commitRecovery(commitBody(k, { token: admin }).input),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
		expect(await snapshot(k.id)).toBe(before);
		expect(await triesSpent(tokenHashOf(admin))).toBe(0);
	});

	it("is 404 for an expired link", async () => {
		const k = await recoverable();
		const expired = await issueLinkFor(k.id, "email", new Date(Date.now() - 2 * HOUR));
		await expect(
			commitRecovery(commitBody(k, { token: expired }).input),
		).rejects.toBeInstanceOf(InvalidResetTokenError);
	});

	it("is a conflict for a stale base version, keeps the link, and keeps the API keys", async () => {
		const k = await recoverable();
		await seedApiKey(k.id);
		await sessionFor(k.id);
		// A rotation moved the version on (the way rotate writes it), without touching the link.
		await adminDb.$transaction((tx) =>
			applyKeyChanges(
				tx,
				k.id,
				{
					baseVersion: 1,
					set: { kdfSalt: p.randomBytes(16), kdfMemoryKiB: 65536, kdfPasses: 3 },
					put: [symmetric("ak-password", k.id)],
					remove: [],
				},
				"rotate",
			),
		);
		const before = await snapshot(k.id);
		await expect(commitRecovery(commitBody(k).input)).rejects.toMatchObject({
			code: "conflict",
		});
		expect(await snapshot(k.id)).toBe(before);
		expect(JSON.parse(before).apiKeys).toBe(1);
		// Starting again from the new version works.
		await expect(
			commitRecovery(commitBody(k, { baseVersion: 2 }).input),
		).resolves.toMatchObject({ version: 3 });
	});

	it("is a conflict when the stored hash changed after it was read, with the link, keys and sessions kept", async () => {
		const k = await recoverable();
		await sessionFor(k.id);
		await seedApiKey(k.id);
		const changed = await hashPassword("Another hash");
		const result = await holdCredentialLock(
			k.id,
			async (tx) => {
				await tx.account.updateMany({
					where: { userId: k.id, providerId: "credential" },
					data: { password: changed },
				});
			},
			() => settled(() => commitRecovery(commitBody(k).input)),
		);
		expect(result).toMatchObject({ error: { code: "conflict" } });
		// The write that got there first is the one that stays.
		expect(await storedHash(k.id)).toBe(changed);
		expect(await adminDb.passwordResetToken.count({ where: { userId: k.id } })).toBe(1);
		expect(await adminDb.session.count({ where: { userId: k.id } })).toBe(1);
		expect(await adminDb.apikey.count({ where: { referenceId: k.id } })).toBe(1);
		expect((await adminDb.protectionKeySet.findUniqueOrThrow({ where: { userId: k.id } })).version).toBe(1);
	});

	it("is 404 and writes nothing when an email reset removed the keys meanwhile, and the reset's hash stays", async () => {
		const k = await recoverable();
		const reset = await hashPassword("What the email reset set");
		const result = await holdCredentialLock(
			k.id,
			// Exactly what the email reset commits: the keys go, the hash is replaced, every link ends.
			async (tx) => {
				await settleKeysForReset(
					tx,
					k.id,
					{ hasKeySet: true, protectionState: "OFF" },
					{ kind: "email" },
				);
				await tx.account.updateMany({
					where: { userId: k.id, providerId: "credential" },
					data: { password: reset },
				});
				await deleteUserResetTokens(tx, k.id);
			},
			() => settled(() => commitRecovery(commitBody(k).input)),
		);
		expect(result).toMatchObject({ error: expect.any(InvalidResetTokenError) });
		expect(await storedHash(k.id)).toBe(reset);
		expect(await adminDb.protectionKeySet.count({ where: { userId: k.id } })).toBe(0);
		expect(await adminDb.protectionKeyWrap.count({ where: { userId: k.id } })).toBe(0);
	});

	it("refuses a recovery hash that changed after the first check, even with the same version", async () => {
		const k = await recoverable();
		await sessionFor(k.id);
		const before = await snapshot(k.id);
		// What Make new key writes, without the version bump a writer would add:
		// the version compare cannot be what refuses this.
		const newHash = hashRecoveryProof(wrongKey());
		const result = await holdCredentialLock(
			k.id,
			async (tx) => {
				await tx.protectionKeySet.update({
					where: { userId: k.id },
					select: { userId: true },
					data: { recoveryHash: Uint8Array.from(newHash) },
				});
			},
			() => settled(() => commitRecovery(commitBody(k).input)),
		);
		expect(result).toMatchObject({ error: { code: "wrong_proof" } });
		const after = JSON.parse(await snapshot(k.id));
		expect({ ...after, recoveryHash: "" }).toEqual({
			...JSON.parse(before),
			recoveryHash: "",
		});
		expect(after.recoveryHash).toBe(Buffer.from(newHash).toString("hex"));
	});

	it("keeps an account without keys out of recovery: no_keys, and the plain hash is untouched", async () => {
		const plain = await passwordUser();
		const token = await issueLinkFor(plain.id);
		const before = await storedHash(plain.id);
		const input: Recover = {
			token,
			recoveryAuthKey: wrongKey(),
			newAuthKey: wrongKey(),
			kdf: { salt: toBase64Url(p.randomBytes(16)), memoryKiB: 65536, passes: 3 },
			wrappedAccountKey: toBase64Url(
				wrapKey(p, p.randomBytes(32), "ak-password", plain.id, p.randomBytes(32)),
			),
			baseVersion: 1,
		};
		await expect(commitRecovery(input)).rejects.toMatchObject({ code: "no_keys" });
		expect(await storedHash(plain.id)).toBe(before);
		expect(await adminDb.passwordResetToken.count({ where: { userId: plain.id } })).toBe(1);
	});

	it("refuses a malformed request before any try is spent", async () => {
		const k = await recoverable();
		const bad = commitBody(k);
		const malformed: Recover[] = [
			{ ...bad.input, newAuthKey: "short" },
			{ ...bad.input, wrappedAccountKey: toBase64Url(new Uint8Array(10)) },
			{ ...bad.input, kdf: { ...bad.input.kdf, passes: 0 } },
			{ ...bad.input, kdf: { ...bad.input.kdf, salt: toBase64Url(new Uint8Array(3)) } },
			{ ...bad.input, baseVersion: 0 },
		];
		for (const input of malformed)
			await expect(commitRecovery(input)).rejects.toBeInstanceOf(ProtectionKeysError);
		expect(await triesSpent(tokenHashOf(k.token))).toBe(0);
	});
});

describe("the recovery key and the sign-in secret stay apart", () => {
	it("a recovery hash is not the hash of the account password, and the password hash is not a proof", async () => {
		const k = await recoverable();
		const set = await adminDb.protectionKeySet.findUniqueOrThrow({
			where: { userId: k.id },
		});
		expect(Buffer.from(set.recoveryHash ?? []).toString("hex")).not.toBe(
			Buffer.from(fromBase64Url(k.recoveryAuthKey) ?? []).toString("hex"),
		);
		await expect(
			commitRecovery(commitBody(k, { recoveryAuthKey: k.authKeyText }).input),
		).rejects.toMatchObject({ code: "wrong_proof" });
	});
});

