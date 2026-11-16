// The password-to-sign-in-secret helper, with the F3 key vectors. Jest cannot
// load the native module, so react-native-libsodium is replaced by libsodium.js
// (same API), as in test/crypto-vectors.test.ts. The Argon2id here is not the
// JSI build: run a real sign-in on a phone before relying on it.
import type { PreloginKdf } from "@retrospend/api-contract";
import type { Primitives } from "@retrospend/crypto";
import { loadWebSodium } from "@retrospend/crypto/web";
import type { SecretDeps } from "./sign-in-secret";

type Helper = typeof import("./sign-in-secret");
let h: Helper;
let p: Primitives;

beforeAll(async () => {
	const sodium = await loadWebSodium();
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	h = require("./sign-in-secret") as Helper;
	p = await require("@/crypto/native").getPrimitives();
});

// keys.vectors.json "floor parameters, fullwidth and decomposed letters,
// emoji": salt a0..af, 46 MiB, 1 pass. The secret is the vector's auth key
// c7546d51...122b as unpadded base64url, written out by hand with python.
const PASSWORD = "Ｐａss wörd 😀";
const KDF: PreloginKdf = {
	salt: "oKGio6SlpqeoqaqrrK2urw",
	memoryKiB: 47104,
	passes: 1,
};
const SECRET = "x1RtUbzhdyTNY63g9nhnEdU9BPz1VuLpIHFlcwDqEis";
const BASE = "https://retrospend.app";
const EMAIL = "Ana.Smith@Example.com";

function memory() {
	const items = new Map<string, string>();
	const store: SecretDeps["store"] = {
		getItemAsync: async (k) => items.get(k) ?? null,
		setItemAsync: async (k, v) => {
			items.set(k, v);
		},
		deleteItemAsync: async (k) => {
			items.delete(k);
		},
	};
	return {
		items,
		deps: (): SecretDeps => ({ store, primitives: async () => p }),
	};
}

const status = (n: number) => Object.assign(new Error("x"), { status: n });
const resolve = (
	deps: SecretDeps,
	lookup: () => Promise<PreloginKdf | null>,
	password = PASSWORD,
) =>
	h.resolveSignInSecret(
		{ baseUrl: BASE, email: EMAIL, password, lookup },
		deps,
	);

describe("resolveSignInSecret", () => {
	it("sends the typed password for an account without keys", async () => {
		const m = memory();
		expect(await resolve(m.deps(), async () => null)).toEqual({
			ok: true,
			secret: PASSWORD,
		});
		expect(m.items.size).toBe(0);
	});

	it("derives the vector's sign-in secret for a keyed account and records it", async () => {
		const m = memory();
		expect(await resolve(m.deps(), async () => KDF)).toEqual({
			ok: true,
			secret: SECRET,
		});
		expect([...m.items.values()]).toEqual(["1"]);
	});

	it("refuses parameters below the floor or above the ceiling before deriving", async () => {
		const argon2id = jest.fn(p.argon2id);
		const m = memory();
		const deps = { ...m.deps(), primitives: async () => ({ ...p, argon2id }) };
		for (const weak of [
			{ ...KDF, memoryKiB: 19 * 1024 },
			{ ...KDF, passes: 0 },
			{ ...KDF, memoryKiB: 300 * 1024 },
			{ ...KDF, passes: 11 },
		]) {
			expect(await resolve(deps, async () => weak)).toEqual({
				ok: false,
				reason: "protectionRefused",
			});
		}
		expect(argon2id).not.toHaveBeenCalled();
		expect(m.items.size).toBe(0);
	});

	it("refuses a salt that is not 16 bytes", async () => {
		const m = memory();
		expect(
			await resolve(m.deps(), async () => ({ ...KDF, salt: "AAAA" })),
		).toEqual({
			ok: false,
			reason: "protectionRefused",
		});
	});

	describe("with the email recorded as keyed", () => {
		async function recorded() {
			const m = memory();
			await h.markKeyed(BASE, EMAIL, m.deps());
			return m;
		}

		it("refuses a null answer, never the typed password", async () => {
			const m = await recorded();
			expect(await resolve(m.deps(), async () => null)).toEqual({
				ok: false,
				reason: "keysMissing",
			});
		});

		it("refuses a network error", async () => {
			const m = await recorded();
			expect(
				await resolve(m.deps(), async () => {
					throw new TypeError("Network request failed");
				}),
			).toEqual({ ok: false, reason: "network" });
		});

		it("refuses a 404 and a 500", async () => {
			const m = await recorded();
			expect(
				await resolve(m.deps(), async () => {
					throw status(404);
				}),
			).toEqual({ ok: false, reason: "keysMissing" });
			expect(
				await resolve(m.deps(), async () => {
					throw status(500);
				}),
			).toEqual({ ok: false, reason: "network" });
		});

		it("still derives when the server answers keyed", async () => {
			const m = await recorded();
			expect(await resolve(m.deps(), async () => KDF)).toEqual({
				ok: true,
				secret: SECRET,
			});
		});

		it("matches the email in any letter case and with spaces around it", async () => {
			const m = await recorded();
			expect(
				await h.resolveSignInSecret(
					{
						baseUrl: BASE,
						email: ` ${EMAIL.toLowerCase()} `,
						password: PASSWORD,
						lookup: async () => null,
					},
					m.deps(),
				),
			).toEqual({ ok: false, reason: "keysMissing" });
		});

		it("is per server: another server is not refused", async () => {
			const m = await recorded();
			expect(
				await h.resolveSignInSecret(
					{
						baseUrl: "https://other.example",
						email: EMAIL,
						password: PASSWORD,
						lookup: async () => null,
					},
					m.deps(),
				),
			).toEqual({ ok: true, secret: PASSWORD });
		});
	});

	it("reports a rate limit as rateLimited, with or without a record", async () => {
		const m = memory();
		const limited = async () => {
			throw status(429);
		};
		expect(await resolve(m.deps(), limited)).toEqual({
			ok: false,
			reason: "rateLimited",
		});
		await h.markKeyed(BASE, EMAIL, m.deps());
		expect(await resolve(m.deps(), limited)).toEqual({
			ok: false,
			reason: "rateLimited",
		});
	});

	describe("isKeyedAccount", () => {
		const ask = (deps: SecretDeps, lookup: () => Promise<PreloginKdf | null>) =>
			h.isKeyedAccount({ baseUrl: BASE, email: EMAIL, lookup }, deps);

		it("is true from the record without asking the server", async () => {
			const m = memory();
			await h.markKeyed(BASE, EMAIL, m.deps());
			const lookup = jest.fn(async () => null);
			expect(await ask(m.deps(), lookup)).toBe(true);
			expect(lookup).not.toHaveBeenCalled();
		});

		it("is true and recorded when the keys route says keyed", async () => {
			const m = memory();
			expect(await ask(m.deps(), async () => KDF)).toBe(true);
			expect(m.items.size).toBe(1);
		});

		it("is false for no keys, null or 404, and null when it cannot tell", async () => {
			const m = memory();
			expect(await ask(m.deps(), async () => null)).toBe(false);
			expect(
				await ask(m.deps(), async () => {
					throw status(404);
				}),
			).toBe(false);
			expect(
				await ask(m.deps(), async () => {
					throw status(500);
				}),
			).toBeNull();
		});
	});

	describe("with no record", () => {
		it("falls back to the typed password on a 404 (a server without prelogin)", async () => {
			const m = memory();
			expect(
				await resolve(m.deps(), async () => {
					throw status(404);
				}),
			).toEqual({ ok: true, secret: PASSWORD });
		});

		it("does not fall back on a network error or a 500", async () => {
			const m = memory();
			for (const error of [new TypeError("offline"), status(500)]) {
				expect(
					await resolve(m.deps(), async () => {
						throw error;
					}),
				).toEqual({ ok: false, reason: "network" });
			}
		});
	});

	it("sends nothing when the keystore cannot be read", async () => {
		const m = memory();
		const deps: SecretDeps = {
			...m.deps(),
			store: {
				...m.deps().store,
				getItemAsync: async () => {
					throw new Error("locked");
				},
			},
		};
		const lookup = jest.fn(async () => null);
		expect(await resolve(deps, lookup)).toEqual({
			ok: false,
			reason: "unknown",
		});
		expect(lookup).not.toHaveBeenCalled();
	});

	it("falls back to the typed password only once the record is forgotten", async () => {
		const m = memory();
		await h.markKeyed(BASE, EMAIL, m.deps());
		expect(await resolve(m.deps(), async () => null)).toEqual({
			ok: false,
			reason: "keysMissing",
		});
		await h.forgetKeyed(BASE, EMAIL, m.deps());
		expect(await resolve(m.deps(), async () => null)).toEqual({
			ok: true,
			secret: PASSWORD,
		});
	});

	it("forgets a record for a deleted account", async () => {
		const m = memory();
		await h.markKeyed(BASE, EMAIL, m.deps());
		await h.forgetKeyed(BASE, EMAIL, m.deps());
		expect(await resolve(m.deps(), async () => null)).toEqual({
			ok: true,
			secret: PASSWORD,
		});
	});
});

describe("keyedRecordKey", () => {
	it("holds no raw email, no host and only keystore-safe characters", () => {
		const key = h.keyedRecordKey(BASE, EMAIL);
		expect(key).toMatch(/^retrospend_keyed_[0-9a-f]{32}$/);
		for (const part of ["ana", "smith", "example", "retrospend.app"]) {
			expect(key.toLowerCase()).not.toContain(part);
		}
	});

	it("is the same for any letter case and differs by email and by server", () => {
		expect(h.keyedRecordKey(BASE, EMAIL)).toBe(
			h.keyedRecordKey(`${BASE}/`, EMAIL.toLowerCase()),
		);
		expect(h.keyedRecordKey(BASE, "bo@example.com")).not.toBe(
			h.keyedRecordKey(BASE, EMAIL),
		);
		expect(h.keyedRecordKey("https://other.example", EMAIL)).not.toBe(
			h.keyedRecordKey(BASE, EMAIL),
		);
	});
});
