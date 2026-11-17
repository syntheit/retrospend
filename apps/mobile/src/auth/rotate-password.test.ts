// Changing the password of a keyed account on the phone, with the F3 key
// vectors (packages/crypto/vectors/keys.vectors.json, the same file the
// crypto and sign-in tests read). Jest cannot load the native module, so
// react-native-libsodium is replaced by libsodium.js (same API); run a real
// password change on a phone before relying on the native Argon2id.
//
// Old password: the vector "floor parameters, fullwidth ..." (salt a0.., 46
// MiB, 1 pass). New password: the vector "default parameters, ASCII", whose
// salt (10..1f) the test hands to the phone as its random salt, so the secret
// and the wrap key the phone makes are the vector's, derived by hand there.
import type { PreloginKdf } from "@retrospend/api-contract";
import {
	fromBase64Url,
	fromHex,
	type Primitives,
	toBase64Url,
	unwrapKey,
	wrapKey,
} from "@retrospend/crypto";
import { loadWebSodium } from "@retrospend/crypto/web";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import type { RotateApi, SecretDeps } from "./sign-in-secret";

type Helper = typeof import("./sign-in-secret");
let h: Helper;
let real: Primitives;

jest.setTimeout(120_000);

beforeAll(async () => {
	const sodium = await loadWebSodium();
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	h = require("./sign-in-secret") as Helper;
	real = await require("@/crypto/native").getPrimitives();
});

const vector = <T>(item: T | undefined): T => {
	if (item === undefined) throw new Error("missing vector");
	return item;
};
const OLD = vector(vectors.masters[1]);
const NEW = vector(vectors.masters[0]);
const AK_VECTOR = vector(vectors.symmetricWraps[0]);
const USER = AK_VECTOR.id;
const AK = fromHex(AK_VECTOR.key);
const BASE = "https://retrospend.app";
const EMAIL = "ana@example.com";

const OLD_KDF: PreloginKdf = {
	salt: "oKGio6SlpqeoqaqrrK2urw",
	memoryKiB: 47104,
	passes: 1,
};
// The vectors' auth keys as unpadded base64url, written out by hand with python.
const OLD_SECRET = "x1RtUbzhdyTNY63g9nhnEdU9BPz1VuLpIHFlcwDqEis";
const NEW_SECRET = "QVCQOJeb5uUBAEPp5OATFAceNSsFWELAgZaZV8JWVac";
const NEW_SALT = "EBESExQVFhcYGRobHB0eHw";

const status = (n: number, code?: string) =>
	Object.assign(new Error("x"), { status: n, code });

// Argon2id is pure, so repeated runs on one input are answered from a cache
// (a copy each time, so a wipe of one result never touches another).
const cache = new Map<string, Uint8Array>();

interface Rig {
	p: Primitives;
	/** Every secret buffer the phone made, to check they are wiped. */
	made: Uint8Array[];
	argon2id: jest.Mock;
	deps: SecretDeps;
	items: Map<string, string>;
}

function rig(
	tamper: {
		/** Changes what a wrap seals: (plaintext key) => key. */
		wrapped?: (key: Uint8Array) => Uint8Array;
		/** Changes the sealed wrap bytes. */
		sealed?: (out: Uint8Array) => Uint8Array;
		/** Changes the auth key the Nth time one is derived (1 = old, 2 = new, 3 = check). */
		authOn?: number;
	} = {},
): Rig {
	const made: Uint8Array[] = [];
	const track = (b: Uint8Array) => {
		made.push(b);
		return b;
	};
	let auths = 0;
	const argon2id = jest.fn((pw: Uint8Array, salt: Uint8Array, params) => {
		const id = `${toBase64Url(pw)}|${toBase64Url(salt)}|${params.memoryKiB}|${params.passes}`;
		let out = cache.get(id);
		if (!out) {
			out = real.argon2id(pw, salt, params);
			cache.set(id, out.slice());
		}
		return track(out.slice());
	});
	const p: Primitives = {
		...real,
		argon2id,
		// The 16 bytes are the salt; the 24 for a wrap's nonce are not secret.
		randomBytes: (n: number) =>
			n === 16 ? track(fromHex(NEW.salt)) : real.randomBytes(n),
		kdfDerive: (master, id, context) => {
			const out = track(real.kdfDerive(master, id, context));
			if (id === 1 && ++auths === tamper.authOn) out[0] = (out[0] ?? 0) ^ 1;
			return out;
		},
		aeadEncrypt: (key, nonce, plain, aad) => {
			const out = real.aeadEncrypt(
				key,
				nonce,
				tamper.wrapped ? tamper.wrapped(plain) : plain,
				aad,
			);
			return tamper.sealed ? tamper.sealed(out) : out;
		},
		aeadDecrypt: (key, nonce, cipher, aad) =>
			track(real.aeadDecrypt(key, nonce, cipher, aad)),
	};
	const items = new Map<string, string>();
	const deps: SecretDeps = {
		store: {
			getItemAsync: async (k) => items.get(k) ?? null,
			setItemAsync: async (k, v) => {
				items.set(k, v);
			},
			deleteItemAsync: async (k) => {
				items.delete(k);
			},
		},
		primitives: async () => p,
	};
	return { p, made, argon2id, deps, items };
}

function oldWrap(userId = USER): string {
	return toBase64Url(
		wrapKey(real, fromHex(OLD.wrapKey), "ak-password", userId, AK),
	);
}

function api(
	over: {
		begin?: jest.Mock;
		rotate?: jest.Mock;
		wrap?: string;
		kdf?: PreloginKdf;
	} = {},
) {
	const begin =
		over.begin ??
		jest.fn(async () => ({
			version: 1,
			kdf: over.kdf ?? OLD_KDF,
			wrappedAccountKey: over.wrap ?? oldWrap(),
		}));
	const rotate =
		over.rotate ?? jest.fn(async () => ({ version: 2, signedOut: 1 }));
	return {
		begin,
		rotate,
		client: {
			beginPasswordRotation: begin,
			rotatePassword: rotate,
		} as unknown as RotateApi,
	};
}

function run(
	r: Rig,
	client: RotateApi,
	over: Partial<Parameters<Helper["rotatePassword"]>[0]> = {},
) {
	let n = 0;
	return h.rotatePassword(
		{
			api: client,
			baseUrl: BASE,
			email: EMAIL,
			userId: USER,
			current: OLD.password,
			next: NEW.password,
			lookup: async () => OLD_KDF,
			newKey: () => `key-${++n}`,
			...over,
		},
		r.deps,
	);
}

const isWiped = (b: Uint8Array) => b.every((x) => x === 0);

describe("rotatePassword", () => {
	it("opens the old wrap, sends the new secret, kdf and a wrap the new password opens", async () => {
		const r = rig();
		const a = api();
		expect(await run(r, a.client)).toEqual({ ok: true });

		expect(a.begin).toHaveBeenCalledTimes(1);
		expect(a.begin).toHaveBeenCalledWith({ currentAuthKey: OLD_SECRET });
		expect(a.rotate).toHaveBeenCalledTimes(1);
		const [body, options] = a.rotate.mock.calls[0] as [
			Record<string, unknown>,
			{ context: { idempotencyKey: string } },
		];
		expect(body).toMatchObject({
			currentAuthKey: OLD_SECRET,
			newAuthKey: NEW_SECRET,
			kdf: { salt: NEW_SALT, memoryKiB: 65536, passes: 3 },
			baseVersion: 1,
		});
		expect(options).toEqual({ context: { idempotencyKey: "key-1" } });
		// The sent wrap opens with the vector's new wrap key to the same AK.
		const sent = fromBase64Url(body.wrappedAccountKey as string);
		expect(sent).not.toBeNull();
		expect(
			unwrapKey(
				real,
				fromHex(NEW.wrapKey),
				"ak-password",
				USER,
				sent as Uint8Array,
			),
		).toEqual(AK);
		expect(Object.keys(body).sort()).toEqual([
			"baseVersion",
			"currentAuthKey",
			"kdf",
			"newAuthKey",
			"wrappedAccountKey",
		]);
		// Still recorded as keyed.
		expect([...r.items.values()]).toEqual(["1"]);
	});

	it("stops at a wrong current password without making a new key", async () => {
		const r = rig();
		const a = api({
			begin: jest.fn(async () => {
				throw status(400, "wrong_password");
			}),
		});
		expect(await run(r, a.client)).toEqual({
			ok: false,
			reason: "wrongPassword",
		});
		expect(a.rotate).not.toHaveBeenCalled();
		expect(r.argon2id).toHaveBeenCalledTimes(1);
	});

	it("sends nothing when the wrap does not open after the proof passed", async () => {
		const r = rig();
		const a = api({ wrap: oldWrap("someone-else") });
		expect(await run(r, a.client)).toEqual({
			ok: false,
			reason: "protectionRefused",
		});
		expect(a.rotate).not.toHaveBeenCalled();
	});

	it("sends nothing when the answer carries a salt or parameters the proof did not use", async () => {
		for (const other of [
			{ ...OLD_KDF, salt: NEW_SALT },
			{ ...OLD_KDF, memoryKiB: 48 * 1024 },
			{ ...OLD_KDF, passes: 2 },
		]) {
			const r = rig();
			const a = api({ kdf: other });
			expect(await run(r, a.client)).toEqual({
				ok: false,
				reason: "protectionRefused",
			});
			expect(a.rotate).not.toHaveBeenCalled();
		}
	});

	it("refuses to send a new wrap that does not open", async () => {
		// The old wrap is made before the tamper takes hold (it uses `real`).
		const r = rig({
			sealed: (out) => {
				const bad = out.slice();
				bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
				return bad;
			},
		});
		const a = api();
		expect(await run(r, a.client)).toEqual({
			ok: false,
			reason: "protectionRefused",
		});
		expect(a.begin).toHaveBeenCalledTimes(1);
		expect(a.rotate).not.toHaveBeenCalled();
	});

	it("refuses to send a new wrap that opens to another account key", async () => {
		const r = rig({ wrapped: () => new Uint8Array(32).fill(7) });
		const a = api();
		expect(await run(r, a.client)).toEqual({
			ok: false,
			reason: "protectionRefused",
		});
		expect(a.rotate).not.toHaveBeenCalled();
	});

	it("refuses to send a sign-in secret the new password does not make again", async () => {
		const r = rig({ authOn: 3 });
		const a = api();
		expect(await run(r, a.client)).toEqual({
			ok: false,
			reason: "protectionRefused",
		});
		expect(a.rotate).not.toHaveBeenCalled();
	});

	describe("a conflict", () => {
		it("starts over once with a new key and then succeeds", async () => {
			const r = rig();
			const rotate = jest
				.fn()
				.mockRejectedValueOnce(status(409, "conflict"))
				.mockResolvedValueOnce({ version: 3, signedOut: 0 });
			const begin = jest
				.fn()
				.mockResolvedValueOnce({
					version: 1,
					kdf: OLD_KDF,
					wrappedAccountKey: oldWrap(),
				})
				.mockResolvedValueOnce({
					version: 2,
					kdf: OLD_KDF,
					wrappedAccountKey: oldWrap(),
				});
			const a = api({ begin, rotate });
			expect(await run(r, a.client)).toEqual({ ok: true });
			expect(begin).toHaveBeenCalledTimes(2);
			expect(rotate).toHaveBeenCalledTimes(2);
			const keys = rotate.mock.calls.map(
				(c) =>
					(c[1] as { context: { idempotencyKey: string } }).context
						.idempotencyKey,
			);
			expect(keys).toEqual(["key-1", "key-2"]);
			expect(rotate.mock.calls[1]?.[0]).toMatchObject({ baseVersion: 2 });
		});

		it("is returned after the second one, with no third try", async () => {
			const r = rig();
			const a = api({
				rotate: jest.fn(async () => {
					throw status(409, "conflict");
				}),
			});
			expect(await run(r, a.client)).toEqual({
				ok: false,
				reason: "conflict",
			});
			expect(a.begin).toHaveBeenCalledTimes(2);
			expect(a.rotate).toHaveBeenCalledTimes(2);
		});

		it("at the proof also starts over", async () => {
			const r = rig();
			const begin = jest
				.fn()
				.mockRejectedValueOnce(status(409, "conflict"))
				.mockResolvedValueOnce({
					version: 1,
					kdf: OLD_KDF,
					wrappedAccountKey: oldWrap(),
				});
			const a = api({ begin });
			expect(await run(r, a.client)).toEqual({ ok: true });
			expect(a.rotate).toHaveBeenCalledTimes(1);
		});
	});

	it("maps other refusals to stable reasons and does not retry them", async () => {
		for (const [error, reason] of [
			[status(429), "rateLimited"],
			[new TypeError("offline"), "network"],
			[status(501, "not_implemented"), "unknown"],
		] as const) {
			const r = rig();
			const a = api({
				rotate: jest.fn(async () => {
					throw error;
				}),
			});
			expect(await run(r, a.client)).toEqual({ ok: false, reason });
			expect(a.rotate).toHaveBeenCalledTimes(1);
		}
	});

	it("says the keys are gone when the lookup is a 404 or null, and calls nothing", async () => {
		for (const lookup of [
			async () => {
				throw status(404);
			},
			async () => null,
		]) {
			const r = rig();
			const a = api();
			expect(await run(r, a.client, { lookup })).toEqual({
				ok: false,
				reason: "keysMissing",
			});
			expect(a.begin).not.toHaveBeenCalled();
		}
	});

	it("refuses parameters below the floor before deriving", async () => {
		const r = rig();
		const a = api();
		expect(
			await run(r, a.client, {
				lookup: async () => ({ ...OLD_KDF, memoryKiB: 19 * 1024 }),
			}),
		).toEqual({ ok: false, reason: "protectionRefused" });
		expect(r.argon2id).not.toHaveBeenCalled();
		expect(a.begin).not.toHaveBeenCalled();
	});

	it("is still done when the keyed record cannot be written", async () => {
		const r = rig();
		r.deps.store.setItemAsync = async () => {
			throw new Error("keystore");
		};
		expect(await run(r, api().client)).toEqual({ ok: true });
	});

	describe("wiping", () => {
		it("wipes every key it made after a change", async () => {
			const r = rig();
			expect(await run(r, api().client)).toEqual({ ok: true });
			// 3 master keys, 6 subkeys, the new salt, the account key twice.
			expect(r.made.length).toBeGreaterThanOrEqual(12);
			expect(r.made.every(isWiped)).toBe(true);
		});

		it("wipes them when the check refuses the send", async () => {
			const r = rig({ authOn: 3 });
			await run(r, api().client);
			expect(r.made.length).toBeGreaterThanOrEqual(10);
			expect(r.made.every(isWiped)).toBe(true);
		});

		it("wipes them when the proof is refused", async () => {
			const r = rig();
			await run(
				r,
				api({
					begin: jest.fn(async () => {
						throw status(400, "wrong_password");
					}),
				}).client,
			);
			expect(r.made.length).toBe(3);
			expect(r.made.every(isWiped)).toBe(true);
		});
	});
});
