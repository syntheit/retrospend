/**
 * POST /api/v1/auth/prelogin on Postgres: every address gets the same shape,
 * only an account with a protection key set gets its salt and parameters, a
 * session changes nothing, and the limits count without keeping the address.
 */
import { createHash } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	sessionFor,
} from "../../core/__tests__/harness";
import { keyedHash } from "~/server/lib/keyed-hash";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// Real implementations, watched: prelogin must not call them, /me must.
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

const route = contract.auth.prelogin;

// Each test has its own address, so the per-IP limit of another test never counts.
let n = 0;
const ip = () => ({ "x-forwarded-for": `203.0.113.${10 + (n++ % 200)}` });

const prelogin = (email: string, headers: Record<string, string> = {}) =>
	call("/auth/prelogin", {
		method: "POST",
		headers: { ...ip(), ...headers },
		body: { email },
	});

/** A salt of the bytes 00 to 0f: base64url "AAECAwQFBgcICQoLDA0ODw". */
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const SALT_TEXT = "AAECAwQFBgcICQoLDA0ODw";

async function keyedUser() {
	const made = await createTestUser();
	await adminDb.protectionKeySet.create({
		data: {
			userId: made.user.id,
			kdfSalt: SALT,
			kdfMemoryKiB: 65536,
			kdfPasses: 3,
			publicKey: new Uint8Array(32).fill(7),
		},
	});
	return made;
}

// The rollback test of the key tables needs them empty, and a worker's database
// outlives the file: leave no key rows behind.
afterAll(async () => {
	await adminDb.protectionKeySet.deleteMany({});
});

/**
 * The limits count in fixed one-minute windows on the clock: a test that
 * fills one must not straddle a boundary, so it waits one out when close.
 */
async function clearMinuteEdge(): Promise<void> {
	const left = 60_000 - (Date.now() % 60_000);
	if (left < 12_000) await new Promise((r) => setTimeout(r, left + 500));
}

describe("POST /auth/prelogin", () => {
	it("answers null for a keyless account and an unknown address, the stored salt and parameters for a keyed one", async () => {
		const keyless = await createTestUser();
		const keyed = await keyedUser();
		const unknown = `nobody-${keyed.user.id}@pg-test.invalid`;

		const a = await expectBody(await prelogin(keyless.user.email), route);
		const b = await expectBody(await prelogin(unknown), route);
		const c = await expectBody(await prelogin(keyed.user.email), route);

		expect(a).toEqual({ kdf: null });
		expect(b).toEqual({ kdf: null });
		expect(c).toEqual({
			kdf: { salt: SALT_TEXT, memoryKiB: 65536, passes: 3 },
		});
	});

	it("matches the address without regard to case or surrounding spaces", async () => {
		const keyed = await keyedUser();
		const body = await expectBody<{ kdf: { salt: string } | null }>(
			await prelogin(keyed.user.email.toUpperCase()),
			route,
		);
		expect(body.kdf?.salt).toBe(SALT_TEXT);
	});

	it("refuses a malformed address", async () => {
		await expectProblem(
			await prelogin("not an email"),
			400,
			"validation_failed",
		);
	});

	it("works with a session, with no Idempotency-Key, and touches neither the keyring nor the zone", async () => {
		const keyed = await keyedUser();
		const token = await sessionFor(keyed.user.id);
		const authorization = { authorization: `Bearer ${token}` };

		// Control: a normal signed-in route does both.
		spies.keyring.mockClear();
		spies.zone.mockClear();
		expect((await call("/me", { headers: authorization })).status).toBe(200);
		expect(spies.keyring).toHaveBeenCalledTimes(1);
		expect(spies.zone).toHaveBeenCalledTimes(1);

		spies.keyring.mockClear();
		spies.zone.mockClear();
		const body = await expectBody<{ kdf: { memoryKiB: number } | null }>(
			await prelogin(keyed.user.email, authorization),
			route,
		);
		expect(body.kdf?.memoryKiB).toBe(65536);
		expect(spies.keyring).not.toHaveBeenCalled();
		expect(spies.zone).not.toHaveBeenCalled();
		// No idempotency record: nothing was started for this user.
		expect(
			await adminDb.idempotencyKey.count({ where: { userId: keyed.user.id } }),
		).toBe(0);
	});

	it("answers an account with protection on, which the guard refuses everywhere else", async () => {
		const keyed = await keyedUser();
		await adminDb.user.update({
			where: { id: keyed.user.id },
			data: { protectionState: "ON" },
		});
		const authorization = {
			authorization: `Bearer ${await sessionFor(keyed.user.id)}`,
		};
		expect((await prelogin(keyed.user.email, authorization)).status).toBe(200);
		await expectProblem(
			await call("/expenses", { headers: authorization }),
			403,
			"protected_account",
		);
	});

	it("limits one address per minute, counting by a hash of it", async () => {
		await clearMinuteEdge();
		const email = `limit-${(await createTestUser()).user.id}@pg-test.invalid`;
		// 120 requests from 120 addresses pass; the next one for this address is refused.
		for (let i = 0; i < 120; i++)
			expect(
				(await prelogin(email, { "x-forwarded-for": `192.0.2.${i + 1}` }))
					.status,
			).toBe(200);
		const refused = await prelogin(email, { "x-forwarded-for": "192.0.2.200" });
		await expectProblem(refused, 429, "rate_limited");
		expect(refused.headers.get("retry-after")).not.toBeNull();

		const keys = (
			await adminDb.apiRateLimit.findMany({
				where: { key: { startsWith: "prelogin:email:" } },
				select: { key: true },
			})
		).map((r) => r.key);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) expect(key).not.toContain("@");
		// A keyed hash, not the plain SHA-256 of the address a list of addresses could match.
		expect(keys).toContain(
			`prelogin:email:${keyedHash("preloginAddress", email)}`,
		);
		expect(keys).not.toContain(
			`prelogin:email:${createHash("sha256").update(email).digest("hex")}`,
		);
	}, 60_000);

	it("counts one address in any letter case against the same limit", async () => {
		await clearMinuteEdge();
		const id = (await createTestUser()).user.id;
		const mixed = `Victim-${id}@Pg-Test.invalid`;
		const lower = mixed.toLowerCase();
		// 60 of each spelling from 120 addresses: together they fill the 120 allowed.
		for (let i = 0; i < 120; i++)
			expect(
				(
					await prelogin(i % 2 === 0 ? mixed : lower, {
						"x-forwarded-for": `198.19.0.${i + 1}`,
					})
				).status,
			).toBe(200);
		await expectProblem(
			await prelogin(lower, { "x-forwarded-for": "198.19.1.1" }),
			429,
			"rate_limited",
		);
		await expectProblem(
			await prelogin(mixed, { "x-forwarded-for": "198.19.1.2" }),
			429,
			"rate_limited",
		);
	}, 60_000);

	it("counts the addresses of one IPv6 /64 as one sender", async () => {
		await clearMinuteEdge();
		const at = (n: number) => ({ "x-forwarded-for": `2001:db8:5:6::${n}` });
		for (let i = 0; i < 30; i++)
			expect(
				(await prelogin(`six-${i}-${Date.now()}@pg-test.invalid`, at(i + 1)))
					.status,
			).toBe(200);
		await expectProblem(
			await prelogin("six-more@pg-test.invalid", {
				"x-forwarded-for": "2001:db8:5:6:aaaa:bbbb:cccc:dddd",
			}),
			429,
			"rate_limited",
		);
		// A neighbouring /64 is a different sender.
		expect(
			(
				await prelogin("six-other@pg-test.invalid", {
					"x-forwarded-for": "2001:db8:5:7::1",
				})
			).status,
		).toBe(200);
	}, 60_000);

	it("limits one address of the sender per minute", async () => {
		await clearMinuteEdge();
		const sender = { "x-forwarded-for": "198.18.0.77" };
		for (let i = 0; i < 30; i++)
			expect(
				(await prelogin(`ip-${i}-${Date.now()}@pg-test.invalid`, sender))
					.status,
			).toBe(200);
		await expectProblem(
			await prelogin("one-more@pg-test.invalid", sender),
			429,
			"rate_limited",
		);
	}, 60_000);
});
