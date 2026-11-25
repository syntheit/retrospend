/**
 * POST /api/v1/me/protection/recovery-key on Postgres (E2EE K3-3, Make new
 * key): what replacing the recovery key writes, that the old key stops
 * working at the commit and not before, what the route refuses, and that it
 * takes turns with the other writers of the key set (rotation, the email
 * reset, the recovery commit). Requests go through the v1 handler. The
 * account is the one enable leaves (`~/test/recoverable`), so the key set,
 * the recovery hash and the wraps are written in production order.
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
import { InvalidResetTokenError } from "~/server/services/auth/reset-tokens";
import { holdCredentialLock, holdSetLock } from "~/test/locks";
import { stayInWindow } from "~/test/rate-window";
import * as fixture from "~/test/recoverable";
import { applyKeyChanges } from "./protection-keys.service";
import { beginRecovery, checkRecovery, commitRecovery } from "./recover";
import { digestOfRecoveryWrap } from "./recovery-digest";
import { hashRecoveryProof } from "./validate";

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
const TRIES_WINDOW_MS = 15 * 60_000;

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});
beforeEach(() => {
	flag.on = true;
	mail.sendEmail.mockClear();
});
afterAll(async () => {
	// A worker's database outlives the file, and the admin event log test counts
	// USER_UPDATED rows: leave none of ours behind.
	await adminDb.eventLog.deleteMany({
		where: {
			eventType: "USER_UPDATED",
			metadata: { path: ["reason"], equals: "recovery_key_replaced" },
		},
	});
	await adminDb.protectionKeyWrap.deleteMany({});
	await adminDb.protectionKeySet.deleteMany({});
});

const keyed = async (opts: { state?: "OFF" | "ON" } = {}) => {
	const k = await fixture.recoverable(opts);
	mail.sendEmail.mockClear();
	return k;
};
const { snapshot, storedHash } = fixture;

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

/** What a device sends: a new recovery key's wrap and proof, with the current sign-in secret. */
function newKeyOf(userId: string, current: string, baseVersion = 1) {
	const recoveryAuthKey = signInSecret(p.randomBytes(32));
	const wrapped = wrapKey(
		p,
		p.randomBytes(32),
		"ak-recovery",
		userId,
		p.randomBytes(32),
	);
	return {
		recoveryAuthKey,
		wrapped,
		body: {
			currentAuthKey: current,
			wrappedRecoveryKey: toBase64Url(wrapped),
			recoveryAuthKey,
			baseVersion,
		},
	};
}

type Headers = Record<string, string>;
const replace = (
	headers: Headers,
	body: unknown,
	idempotent: boolean | string = true,
) =>
	call("/me/protection/recovery-key", {
		method: "POST",
		headers,
		body,
		idempotent,
	});

const hex = (b: Uint8Array | null) => Buffer.from(b ?? []).toString("hex");
const setRow = (userId: string) =>
	adminDb.protectionKeySet.findUniqueOrThrow({ where: { userId } });
const wrapRows = (userId: string) =>
	adminDb.protectionKeyWrap.findMany({
		where: { userId },
		orderBy: [{ role: "asc" }, { targetId: "asc" }],
	});
const wrapsOf = async (userId: string) =>
	(await wrapRows(userId)).map((w) => `${w.id}|${w.role}|${hex(w.wrapped)}`);
const sessionExists = async (token: string) =>
	(await adminDb.session.findUnique({ where: { token } })) !== null;
const settled = <T>(run: () => Promise<T>) =>
	run().then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);

describe("POST /me/protection/recovery-key", () => {
	it("replaces the recovery wrap and the proof together, bumps the version and touches nothing else", async () => {
		const k = await keyed({ state: "ON" });
		const me = await mobile(k.id);
		const other = await sessionFor(k.id);
		const before = await wrapRows(k.id);
		const oldWrap = before.find((w) => w.role === "ak-recovery");
		const set = await setRow(k.id);
		const hash = await storedHash(k.id);
		const r = newKeyOf(k.id, k.authKeyText);

		const done = await expectBody<{ version: number }>(
			await replace(me.headers, r.body),
			route.newRecoveryKey,
		);
		expect(done).toEqual({ version: 2 });

		const after = await setRow(k.id);
		expect(after.version).toBe(2);
		// The proof is the hash of the new proof, and only the hash is stored.
		expect(hex(after.recoveryHash)).toBe(
			hex(hashRecoveryProof(r.recoveryAuthKey)),
		);
		expect(hex(after.recoveryHash)).not.toBe(hex(set.recoveryHash));
		// The parameters, the public key and the creation time do not move.
		expect(hex(after.kdfSalt)).toBe(hex(set.kdfSalt));
		expect([after.kdfMemoryKiB, after.kdfPasses]).toEqual([
			set.kdfMemoryKiB,
			set.kdfPasses,
		]);
		expect(hex(after.publicKey)).toBe(hex(set.publicKey));
		expect(after.createdAt.toISOString()).toBe(set.createdAt.toISOString());

		const rows = await wrapRows(k.id);
		const recoveryWraps = rows.filter((w) => w.role === "ak-recovery");
		expect(recoveryWraps).toHaveLength(1);
		expect(hex(recoveryWraps[0]?.wrapped ?? null)).toBe(hex(r.wrapped));
		expect(recoveryWraps[0]?.targetId).toBe(k.id);
		// The old wrap row is gone, not kept: it would still open the account key.
		expect(rows.some((w) => w.id === oldWrap?.id)).toBe(false);
		expect(rows).toHaveLength(before.length);
		// Every other wrap is byte for byte what it was.
		for (const w of before.filter((x) => x.role !== "ak-recovery")) {
			const now = rows.find((x) => x.id === w.id);
			expect(hex(now?.wrapped ?? null)).toBe(hex(w.wrapped));
		}

		// The password, the sessions and the protection state stay as they were.
		expect(await storedHash(k.id)).toBe(hash);
		expect(await sessionExists(me.token)).toBe(true);
		expect(await sessionExists(other)).toBe(true);
		expect(
			(await adminDb.user.findUniqueOrThrow({ where: { id: k.id } }))
				.protectionState,
		).toBe("ON");

		const audit = await adminDb.eventLog.findMany({
			where: { userId: k.id, eventType: "USER_UPDATED" },
		});
		expect(audit).toHaveLength(1);
		expect(audit[0]?.metadata).toEqual({ reason: "recovery_key_replaced" });
		expect(JSON.stringify(audit[0])).not.toContain(k.email);
		expect(
			await adminDb.apiEvent.count({
				where: { actorUserId: k.id, type: "user.recovery_key_replaced" },
			}),
		).toBe(1);
	});

	it("mails the account once after the commit, with no key material, and none after a refusal", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		await expectProblem(
			await replace(me.headers, newKeyOf(k.id, k.authKeyText, 2).body),
			409,
			"conflict",
		);
		await expectProblem(
			await replace(
				me.headers,
				newKeyOf(k.id, signInSecret(p.randomBytes(32))).body,
			),
			400,
			"wrong_password",
		);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		const r = newKeyOf(k.id, k.authKeyText);
		await expectBody(await replace(me.headers, r.body), route.newRecoveryKey);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		const [to, subject, html] = mail.sendEmail.mock.calls[0] ?? ["", "", ""];
		expect(to).toBe(k.email);
		expect(subject).toBe("Your recovery key was replaced");
		for (const secret of [
			r.recoveryAuthKey,
			r.body.wrappedRecoveryKey,
			k.authKeyText,
			k.recoveryAuthKey,
			k.id,
		])
			expect(html).not.toContain(secret);
	});

	it("still answers 200 and stores the key when the mailer throws", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		mail.sendEmail.mockRejectedValueOnce(new Error("smtp down"));
		const r = newKeyOf(k.id, k.authKeyText);
		await expectBody(await replace(me.headers, r.body), route.newRecoveryKey);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);
		expect(hex((await setRow(k.id)).recoveryHash)).toBe(
			hex(hashRecoveryProof(r.recoveryAuthKey)),
		);
	});

	it("shows the new wrap through its digest and nothing of the proof or the wrap in the answer", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const r = newKeyOf(k.id, k.authKeyText);
		const res = await replace(me.headers, r.body);
		const text = await res.clone().text();
		for (const secret of [
			r.recoveryAuthKey,
			r.body.wrappedRecoveryKey,
			k.authKeyText,
		])
			expect(text).not.toContain(secret);
		await expectBody(res, route.newRecoveryKey);
		const opened = await expectBody<{ recoveryWrapDigest: string }>(
			await call("/me/protection/keys/open", {
				method: "POST",
				headers: me.headers,
				body: { authKey: k.authKeyText },
			}),
			route.openKeys,
		);
		expect(opened.recoveryWrapDigest).toBe(
			toBase64Url(await digestOfRecoveryWrap(r.wrapped)),
		);
	});

	it("gives a set made before the recovery proof existed its first proof", async () => {
		const k = await keyed();
		await adminDb.protectionKeySet.update({
			where: { userId: k.id },
			data: { recoveryHash: null },
		});
		expect((await checkRecovery(k.token)).keys).toBe("noRecovery");
		const me = await mobile(k.id);
		const r = newKeyOf(k.id, k.authKeyText);
		await expectBody(await replace(me.headers, r.body), route.newRecoveryKey);
		expect(hex((await setRow(k.id)).recoveryHash)).toBe(
			hex(hashRecoveryProof(r.recoveryAuthKey)),
		);
		expect((await checkRecovery(k.token)).keys).toBe("recovery");
	});

	describe("the old recovery key", () => {
		it("still works until the new key is committed, and fails recovery afterwards", async () => {
			const k = await keyed();
			const me = await mobile(k.id);
			// Before: the old key is the proof.
			const begun = await beginRecovery({
				token: k.token,
				recoveryAuthKey: k.recoveryAuthKey,
			});
			expect(begun.version).toBe(1);

			const r = newKeyOf(k.id, k.authKeyText);
			await expectBody(await replace(me.headers, r.body), route.newRecoveryKey);

			await expect(
				beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey }),
			).rejects.toMatchObject({ code: "wrong_proof" });
			const before = await snapshot(k.id);
			const old = fixture.commitBody(p, k, { baseVersion: 2 });
			await expect(commitRecovery(old.input)).rejects.toMatchObject({
				code: "wrong_proof",
			});
			// Nothing changed: the link, the password and the keys are as they were.
			expect(await snapshot(k.id)).toBe(before);
			await expect(checkRecovery(k.token)).resolves.toMatchObject({
				keys: "recovery",
			});
			// The new key is the proof now.
			const fresh = fixture.commitBody(p, k, {
				baseVersion: 2,
				recoveryAuthKey: r.recoveryAuthKey,
			});
			await expect(commitRecovery(fresh.input)).resolves.toMatchObject({
				version: 3,
			});
			await expect(checkRecovery(k.token)).rejects.toBeInstanceOf(
				InvalidResetTokenError,
			);
		});

		it("cannot commit when the new key lands while the commit waits for the set lock", async () => {
			const k = await keyed();
			const before = await snapshot(k.id);
			const newHash = hashRecoveryProof(signInSecret(p.randomBytes(32)));
			// The holder is what the route writes (the real writer, in its own
			// transaction). The commit checked the old key before it, so only its
			// check under the set lock can refuse. Its baseVersion is the version
			// the new key makes: the version compare passes, the proof must not.
			const old = fixture.commitBody(p, k, { baseVersion: 2 });
			const result = await holdSetLock(
				k.id,
				async (tx) => {
					await applyKeyChanges(
						tx,
						k.id,
						{
							baseVersion: 1,
							recoveryHash: newHash,
							put: [
								{
									role: "ak-recovery",
									targetId: k.id,
									wrapped: wrapKey(
										p,
										p.randomBytes(32),
										"ak-recovery",
										k.id,
										p.randomBytes(32),
									),
								},
							],
							remove: [],
						},
						"newRecoveryKey",
					);
				},
				() => settled(() => commitRecovery(old.input)),
			);
			expect(result).toMatchObject({ error: { code: "wrong_proof" } });
			const after = JSON.parse(await snapshot(k.id));
			const was = JSON.parse(before);
			// Only the new key's own writes: the commit left the hash, sessions,
			// links and API keys alone, and the link is still live.
			expect(after.hash).toBe(was.hash);
			expect(after.tokens).toBe(was.tokens);
			expect(after.apiKeys).toBe(was.apiKeys);
			expect(after.version).toBe(2);
			expect(after.recoveryHash).toBe(hex(newHash));
			await expect(checkRecovery(k.token)).resolves.toMatchObject({
				keys: "recovery",
			});
		});
	});

	it("counts a wrong current key as a try and changes nothing, then stops at the limit", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const k = await keyed();
		const me = await mobile(k.id);
		const before = await snapshot(k.id);
		const r = newKeyOf(k.id, signInSecret(p.randomBytes(32)));
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await replace(me.headers, r.body),
				400,
				"wrong_password",
			);
		expect(await snapshot(k.id)).toBe(before);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		// The sixth is refused even with the right key.
		const res = await replace(me.headers, newKeyOf(k.id, k.authKeyText).body);
		await expectProblem(res, 429, "rate_limited");
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(await snapshot(k.id)).toBe(before);
	}, 120_000);

	it("shares the tries with every other password check of the account", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const k = await keyed();
		// Four sessions use up their own 5 of the account's 20.
		for (let s = 0; s < 4; s++) {
			const other = await mobile(k.id);
			for (let i = 0; i < 5; i++)
				await expectProblem(
					await replace(
						other.headers,
						newKeyOf(k.id, signInSecret(p.randomBytes(32))).body,
					),
					400,
					"wrong_password",
				);
		}
		const res = await replace(
			(await mobile(k.id)).headers,
			newKeyOf(k.id, k.authKeyText).body,
		);
		await expectProblem(res, 429, "rate_limited");
		expect((await setRow(k.id)).version).toBe(1);
	}, 120_000);

	it("answers conflict for a stale baseVersion and changes nothing, so the old key still recovers", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const before = await snapshot(k.id);
		await expectProblem(
			await replace(me.headers, newKeyOf(k.id, k.authKeyText, 2).body),
			409,
			"conflict",
		);
		expect(await snapshot(k.id)).toBe(before);
		await expect(
			beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey }),
		).resolves.toMatchObject({ version: 1 });
	});

	it("answers conflict, not wrong password, for the old key after the password was rotated", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		// A rotation that committed since the caller read the version: new hash, version 2.
		const rotated = signInSecret(p.randomBytes(32));
		await adminDb.$transaction(async (tx) => {
			await tx.account.updateMany({
				where: { userId: k.id, providerId: "credential" },
				data: { password: await hashPassword(rotated) },
			});
			await applyKeyChanges(
				tx,
				k.id,
				{
					baseVersion: 1,
					set: {
						kdfSalt: p.randomBytes(16),
						kdfMemoryKiB: 65536,
						kdfPasses: 3,
					},
					put: [
						{
							role: "ak-password",
							targetId: k.id,
							wrapped: wrapKey(
								p,
								p.randomBytes(32),
								"ak-password",
								k.id,
								p.randomBytes(32),
							),
						},
					],
					remove: [],
				},
				"rotate",
			);
		});
		const before = await snapshot(k.id);
		await expectProblem(
			await replace(me.headers, newKeyOf(k.id, k.authKeyText, 1).body),
			409,
			"conflict",
		);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("answers conflict for an account without keys, and spends no try", async () => {
		stayInWindow(TRIES_WINDOW_MS);
		const u = await fixture.passwordUser();
		const me = await mobile(u.id);
		const body = newKeyOf(u.id, signInSecret(p.randomBytes(32))).body;
		for (let i = 0; i < 7; i++)
			await expectProblem(await replace(me.headers, body), 409, "conflict");
		expect(
			await adminDb.protectionKeyWrap.count({ where: { userId: u.id } }),
		).toBe(0);
		expect(
			await adminDb.protectionKeySet.count({ where: { userId: u.id } }),
		).toBe(0);
	}, 120_000);

	it("is refused with 501 when the server does not offer it, and writes nothing", async () => {
		flag.on = false;
		const k = await keyed();
		const me = await mobile(k.id);
		const before = await snapshot(k.id);
		await expectProblem(
			await replace(me.headers, newKeyOf(k.id, k.authKeyText).body),
			501,
			"not_implemented",
		);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("is for the person's own session: not a token, a device session or a phone without account:security", async () => {
		const k = await keyed();
		const body = newKeyOf(k.id, k.authKeyText).body;
		const token = await asKey(k.id, ["read", "write:settings"]);
		const device = await mobile(k.id, {
			scopes: "read write:settings",
			clientId: "some-device",
		});
		const narrowed = await mobile(k.id, {
			scopes: "read write:expenses write:money",
			clientId: "retrospend-mobile",
		});
		// After the callers exist: the snapshot counts sessions and API keys.
		const before = await snapshot(k.id);
		for (const headers of [token, device.headers, narrowed.headers])
			await expectProblem(await replace(headers, body), 403, "missing_scope");
		expect(await snapshot(k.id)).toBe(before);
	});

	it("needs an Idempotency-Key", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const before = await snapshot(k.id);
		await expectProblem(
			await replace(me.headers, newKeyOf(k.id, k.authKeyText).body, false),
			400,
			"idempotency_key_required",
		);
		expect(await snapshot(k.id)).toBe(before);
	});

	it("replays the first answer for the same key without writing again, and refuses the key with another wrap", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const r = newKeyOf(k.id, k.authKeyText);
		const key = randomUUID();
		const first = await expectBody(
			await replace(me.headers, r.body, key),
			route.newRecoveryKey,
		);
		const stored = await snapshot(k.id);
		const second = await replace(me.headers, r.body, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await expectBody(second, route.newRecoveryKey)).toEqual(first);
		expect(await snapshot(k.id)).toBe(stored);
		expect(
			await adminDb.eventLog.count({
				where: { userId: k.id, eventType: "USER_UPDATED" },
			}),
		).toBe(1);
		// The wrap is part of the request, so another wrap under the same key is a different request.
		const other = newKeyOf(k.id, k.authKeyText);
		await expectProblem(
			await replace(
				me.headers,
				{ ...r.body, wrappedRecoveryKey: other.body.wrappedRecoveryKey },
				key,
			),
			422,
			"idempotency_key_reused",
		);
		expect(await snapshot(k.id)).toBe(stored);
	});

	it("refuses a malformed request before any try is spent", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const r = newKeyOf(k.id, k.authKeyText);
		const before = await snapshot(k.id);
		const loose = `${r.recoveryAuthKey.slice(0, -1)}9`;
		const refused: unknown[] = [
			{ ...r.body, recoveryAuthKey: loose },
			{ ...r.body, recoveryAuthKey: r.recoveryAuthKey.slice(0, 42) },
			{ ...r.body, currentAuthKey: `${k.authKeyText.slice(0, -1)}9` },
			// A wrap of the wrong length, and one with the wrong kind byte.
			{ ...r.body, wrappedRecoveryKey: toBase64Url(r.wrapped.slice(0, 60)) },
			{
				...r.body,
				wrappedRecoveryKey: toBase64Url(
					Uint8Array.from(r.wrapped, (b, i) => (i === 1 ? b ^ 1 : b)),
				),
			},
			{ ...r.body, baseVersion: 0 },
		];
		for (const body of refused) {
			const res = await replace(me.headers, body);
			expect(res.status, JSON.stringify(body)).toBe(400);
		}
		expect(await snapshot(k.id)).toBe(before);
		// None of them counted: a full 5 tries are still there.
		const ok = await replace(me.headers, r.body);
		expect(ok.status).toBe(200);
	});

	it("is all or nothing when the database fails after the key set write", async () => {
		const k = await keyed();
		const me = await mobile(k.id);
		const before = await snapshot(k.id);
		// The audit insert is the last write: the set and the wrap have been written.
		const guard = `newkey_fail_${randomBytes(4).toString("hex")}`;
		await adminDb.$executeRawUnsafe(`
			CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN RAISE EXCEPTION 'new key test failure'; END $$`);
		await adminDb.$executeRawUnsafe(`
			CREATE TRIGGER ${guard} BEFORE INSERT ON "event_log"
			FOR EACH ROW WHEN (NEW."userId" = '${k.id}') EXECUTE FUNCTION ${guard}()`);
		try {
			const res = await replace(me.headers, newKeyOf(k.id, k.authKeyText).body);
			expect(res.status).toBe(500);
		} finally {
			await adminDb.$executeRawUnsafe(
				`DROP TRIGGER IF EXISTS ${guard} ON "event_log"`,
			);
			await adminDb.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${guard}()`);
		}
		expect(await snapshot(k.id)).toBe(before);
		await expect(
			beginRecovery({ token: k.token, recoveryAuthKey: k.recoveryAuthKey }),
		).resolves.toMatchObject({ version: 1 });
	});

	describe("takes turns with the other writers", () => {
		it("answers conflict, with the hash untouched, when the hash changed after it checked the key", async () => {
			const k = await keyed();
			const me = await mobile(k.id);
			const taken = await hashPassword("a hash another writer stored");
			const before = await wrapsOf(k.id);
			// Another writer holds the credential lock and changes only the hash;
			// the key set and its version stay as they were.
			const result = await holdCredentialLock(
				k.id,
				async (tx) => {
					await tx.account.updateMany({
						where: { userId: k.id, providerId: "credential" },
						data: { password: taken },
					});
				},
				() => replace(me.headers, newKeyOf(k.id, k.authKeyText).body),
			);
			await expectProblem(result, 409, "conflict");
			expect(await storedHash(k.id)).toBe(taken);
			expect((await setRow(k.id)).version).toBe(1);
			expect(await wrapsOf(k.id)).toEqual(before);
			expect(
				await verifyPassword({
					password: "a hash another writer stored",
					hash: await storedHash(k.id),
				}),
			).toBe(true);
		});

		it("answers conflict when an email reset removed the keys while it waited, and leaves no key set", async () => {
			const k = await keyed();
			const me = await mobile(k.id);
			const reset = await hashPassword("A reset password 3");
			const result = await holdCredentialLock(
				k.id,
				async (tx) => {
					await tx.protectionKeyWrap.deleteMany({ where: { userId: k.id } });
					await tx.protectionKeySet.deleteMany({ where: { userId: k.id } });
					await tx.account.updateMany({
						where: { userId: k.id, providerId: "credential" },
						data: { password: reset },
					});
				},
				() => replace(me.headers, newKeyOf(k.id, k.authKeyText).body),
			);
			await expectProblem(result, 409, "conflict");
			expect(
				await adminDb.protectionKeySet.count({ where: { userId: k.id } }),
			).toBe(0);
			expect(
				await adminDb.protectionKeyWrap.count({ where: { userId: k.id } }),
			).toBe(0);
			expect(await storedHash(k.id)).toBe(reset);
		});

		it("answers conflict when the keys are removed under it and the hash is the one it checked, and writes no key set", async () => {
			const k = await keyed();
			const me = await mobile(k.id);
			const hash = await storedHash(k.id);
			const result = await holdCredentialLock(
				k.id,
				async (tx) => {
					await tx.protectionKeyWrap.deleteMany({ where: { userId: k.id } });
					await tx.protectionKeySet.deleteMany({ where: { userId: k.id } });
				},
				() => replace(me.headers, newKeyOf(k.id, k.authKeyText).body),
			);
			await expectProblem(result, 409, "conflict");
			expect(
				await adminDb.protectionKeySet.count({ where: { userId: k.id } }),
			).toBe(0);
			expect(
				await adminDb.protectionKeyWrap.count({ where: { userId: k.id } }),
			).toBe(0);
			expect(await storedHash(k.id)).toBe(hash);
		});

		it("answers conflict when a rotation commits first: the version moved and the new key is not written", async () => {
			const k = await keyed();
			const me = await mobile(k.id);
			const before = await wrapsOf(k.id);
			// A writer of the key set that takes the set lock first and bumps the version.
			const result = await holdSetLock(
				k.id,
				async (tx) => {
					await tx.protectionKeySet.update({
						where: { userId: k.id },
						select: { userId: true },
						data: { version: 2 },
					});
				},
				() => replace(me.headers, newKeyOf(k.id, k.authKeyText).body),
			);
			await expectProblem(result, 409, "conflict");
			expect((await setRow(k.id)).version).toBe(2);
			expect(hex((await setRow(k.id)).recoveryHash)).toBe(
				hex(hashRecoveryProof(k.recoveryAuthKey)),
			);
			expect(await wrapsOf(k.id)).toEqual(before);
		});

		it("lets exactly one of two new keys from the same state win, and the loser's key never works", async () => {
			const k = await keyed();
			const a = await mobile(k.id);
			const b = await mobile(k.id);
			const ra = newKeyOf(k.id, k.authKeyText);
			const rb = newKeyOf(k.id, k.authKeyText);
			const [x, y] = await Promise.all([
				replace(a.headers, ra.body),
				replace(b.headers, rb.body),
			]);
			expect([x.status, y.status].sort()).toEqual([200, 409]);
			const winner = x.status === 200 ? ra : rb;
			const set = await setRow(k.id);
			expect(set.version).toBe(2);
			expect(hex(set.recoveryHash)).toBe(
				hex(hashRecoveryProof(winner.recoveryAuthKey)),
			);
			const wraps = (await wrapRows(k.id)).filter(
				(w) => w.role === "ak-recovery",
			);
			expect(wraps.map((w) => hex(w.wrapped))).toEqual([hex(winner.wrapped)]);
		});
	});
});
