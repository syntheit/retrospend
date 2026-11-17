// The package's contract, tested where each rule lives: what the production
// entry exports, that only CryptoError leaves it, and that each size guard
// fires before the cipher. A guard test counts the cipher calls, because the
// cipher refuses the same bad input a moment later and would hide a deleted
// guard.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as entry from "../src";
import {
	CryptoError,
	generateCollectionKey,
	HEADER_BYTES,
	ID_PATTERN,
	KEY_ID_BYTES,
	KEY_ID_HEX_PATTERN,
	MAX_PLAINTEXT_BYTES,
	openRecord,
	PAD_BUCKET_BYTES,
	type Primitives,
	PUBLIC_WRAP_BYTES,
	type RecordContext,
	SYMMETRIC_WRAP_BYTES,
	sealRecord,
	signInSecret,
	TAG_BYTES,
	toHex,
	unwrapKey,
	WRAP_SYMMETRIC,
	WRAP_TO_PUBLIC,
	WRAP_VERSION,
	wrapKey,
} from "../src";
import { createPrimitives, type SodiumLike } from "../src/primitives";
import { unwrapKeyFromPublic, wrapKeyToPublic } from "../src/public-wraps";
import { loadWebSodium } from "../src/web";

let p: Primitives;
let sodium: SodiumLike;
beforeAll(async () => {
	sodium = (await loadWebSodium()) as SodiumLike;
	p = createPrimitives(sodium);
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof CryptoError ? e.code : `other:${String(e)}`;
	}
	return "none";
};
const bytes = (n: number, start = 0) =>
	Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);

/** The primitives with the cipher calls counted. */
function counted() {
	const seal = vi.fn(p.aeadEncrypt);
	const open = vi.fn(p.aeadDecrypt);
	return { q: { ...p, aeadEncrypt: seal, aeadDecrypt: open }, seal, open };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
/** Every source file `file` reaches through relative imports and re-exports. */
function reach(file: string, seen = new Set<string>()): Set<string> {
	const path = resolve(root, file);
	if (seen.has(path)) return seen;
	seen.add(path);
	const text = readFileSync(path, "utf8");
	for (const m of text.matchAll(/from "(\.[^"]+)"/g)) {
		const rel = m[1] as string;
		if (rel.endsWith(".json")) {
			seen.add(resolve(dirname(path), rel));
			continue;
		}
		reach(`${resolve(dirname(path), rel)}.ts`, seen);
	}
	return seen;
}

describe("the production entry", () => {
	it("does not export the unauthenticated public-key wraps, the bench or the self-test", () => {
		for (const name of [
			"wrapKeyToPublic",
			"unwrapKeyFromPublic",
			"runKnownAnswerTests",
			"runCryptoBench",
			"benchRows",
			"benchJson",
		]) {
			expect(name in entry).toBe(false);
		}
	});

	it("never reaches the bench, the self-test, the vectors or the public-key wraps", () => {
		const names = [...reach("index.ts")].map((f) => f.slice(root.length));
		expect(
			names.some((n) => /bench|self-test|vectors|public-wraps/.test(n)),
		).toBe(false);
		// The check walks something: the entry reaches its own modules.
		expect(names).toContain("/keys.ts");
	});

	it("shares the wrap layout and the id rule with the server", () => {
		const key = bytes(32);
		const wrapped = wrapKey(p, bytes(32, 7), "ak-password", "u1", key);
		expect(wrapped.length).toBe(SYMMETRIC_WRAP_BYTES);
		expect(wrapped.slice(0, 2)).toEqual(
			Uint8Array.of(WRAP_VERSION, WRAP_SYMMETRIC),
		);
		const pair = p.boxKeypair();
		const toKey = wrapKeyToPublic(p, pair.publicKey, "ak-device", "d1", key);
		expect(toKey.length).toBe(PUBLIC_WRAP_BYTES);
		expect(toKey.slice(0, 2)).toEqual(
			Uint8Array.of(WRAP_VERSION, WRAP_TO_PUBLIC),
		);
		// The values the key-set migration's CHECKs pin (20261115200000).
		expect([SYMMETRIC_WRAP_BYTES, PUBLIC_WRAP_BYTES]).toEqual([74, 98]);
		expect(ID_PATTERN.test("a_B-9")).toBe(true);
		expect(ID_PATTERN.test("a|b")).toBe(false);
		// A collection key id as text is the hex of its bytes, and only that.
		const id = generateCollectionKey(p).keyId;
		expect(KEY_ID_HEX_PATTERN.test(toHex(id))).toBe(true);
		expect(KEY_ID_HEX_PATTERN.test(toHex(id).toUpperCase())).toBe(false);
		expect(KEY_ID_HEX_PATTERN.test(toHex(id).slice(1))).toBe(false);
		expect(ID_PATTERN.test("a".repeat(65))).toBe(false);
	});
});

describe("only CryptoError leaves the package", () => {
	it("signInSecret refuses anything but 32 bytes with CryptoError", () => {
		for (const bad of [
			new Uint8Array(31),
			new Uint8Array(33),
			"x".repeat(32),
			null,
			undefined,
			Array.from({ length: 32 }, () => 0),
		]) {
			expect(code(() => signInSecret(bad as never))).toBe("invalid_input");
		}
	});

	it("blake2b refuses a null or non-bytes key instead of hashing unkeyed", () => {
		const m = bytes(8);
		expect(code(() => p.blake2b(m, 32, null as never))).toBe("invalid_input");
		expect(code(() => p.blake2b(m, 32, "k".repeat(32) as never))).toBe(
			"invalid_input",
		);
		expect(code(() => p.blake2b(m, 32, bytes(8)))).toBe("invalid_input");
		expect(p.blake2b(m, 32, undefined)).toHaveLength(32);
	});

	it("refuses non-bytes arguments to the wrap and header functions", () => {
		expect(code(() => entry.readHeader("x" as never))).toBe("invalid_input");
		expect(
			code(() => unwrapKey(p, bytes(32), "ak-password", "u", null as never)),
		).toBe("invalid_input");
		expect(
			code(() => wrapKey(p, bytes(32), "ak-password", "u", null as never)),
		).toBe("invalid_input");
		expect(
			code(() => wrapKey(p, bytes(32), "ak-password", 7 as never, bytes(32))),
		).toBe("invalid_input");
	});

	// A library that throws its own errors, with text that names the input.
	const LEAK = "secret-input-text";
	const failing = (method: keyof SodiumLike): SodiumLike =>
		new Proxy(sodium, {
			get(target, prop, receiver) {
				if (prop === method) {
					return () => {
						throw new Error(LEAK);
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});
	const calls: [string, keyof SodiumLike, (q: Primitives) => unknown][] = [
		["randomBytes", "randombytes_buf", (q) => q.randomBytes(8)],
		[
			"aeadEncrypt",
			"crypto_aead_xchacha20poly1305_ietf_encrypt",
			(q) => q.aeadEncrypt(bytes(32), bytes(24), bytes(5), "aad"),
		],
		[
			"argon2id",
			"crypto_pwhash",
			(q) => q.argon2id(bytes(4), bytes(16), { memoryKiB: 8, passes: 1 }),
		],
		[
			"kdfDerive",
			"crypto_kdf_derive_from_key",
			(q) => q.kdfDerive(bytes(32), 1, "rs.mk.v1"),
		],
		["blake2b", "crypto_generichash", (q) => q.blake2b(bytes(3), 32)],
		["boxKeypair", "crypto_box_keypair", (q) => q.boxKeypair()],
		[
			"boxKeypairFromSeed",
			"crypto_box_seed_keypair",
			(q) => q.boxKeypairFromSeed(bytes(32)),
		],
		["seal", "crypto_box_seal", (q) => q.seal(bytes(4), bytes(32))],
	];
	it.each(calls)(
		"%s wraps a raw libsodium error without its text",
		(_n, method, run) => {
			let thrown: unknown;
			try {
				run(createPrimitives(failing(method)));
			} catch (e) {
				thrown = e;
			}
			expect(thrown).toBeInstanceOf(CryptoError);
			expect((thrown as CryptoError).code).toBe("invalid_input");
			expect(String((thrown as CryptoError).message)).not.toContain(LEAK);
		},
	);
});

describe("size guards fire before the cipher", () => {
	const keyId = bytes(KEY_ID_BYTES, 0xa0);
	const key = bytes(32);
	const recordKey = { keyId, key };
	const ctx: RecordContext = {
		userId: "u1",
		collectionId: "c1",
		entity: 1,
		recordId: "r1",
		version: 1,
	};

	/** A sealed record with a valid header and `plain` bytes of declared plaintext. */
	const fake = (plain: number) => {
		const out = new Uint8Array(HEADER_BYTES + plain + TAG_BYTES);
		out[0] = 1;
		out[1] = 1;
		out.set(keyId, 2);
		return out;
	};

	it.each([
		["empty", 0],
		["under one bucket", PAD_BUCKET_BYTES - 32],
		["not a whole bucket", PAD_BUCKET_BYTES + 1],
		["over the cap by one bucket", MAX_PLAINTEXT_BYTES + PAD_BUCKET_BYTES],
		["far over the cap", MAX_PLAINTEXT_BYTES * 2],
	])(
		"openRecord refuses a declared plaintext of %s before any key or cipher work",
		(_n, plain) => {
			const { q, open } = counted();
			const find = vi.fn(() => key);
			expect(code(() => openRecord(q, find, ctx, fake(plain)))).toBe(
				"decrypt_failed",
			);
			expect(open).not.toHaveBeenCalled();
			expect(find).not.toHaveBeenCalled();
		},
	);

	it("openRecord accepts the largest plaintext the cap allows", () => {
		const json = MAX_PLAINTEXT_BYTES - 3;
		const record = { a: "x".repeat(json - 8) };
		const sealed = sealRecord(p, recordKey, ctx, 1, record);
		expect(sealed.length).toBe(HEADER_BYTES + MAX_PLAINTEXT_BYTES + TAG_BYTES);
		expect(openRecord(p, () => key, ctx, sealed).record).toEqual(record);
	});

	it("sealRecord refuses a record that would pad past the cap before encrypting", () => {
		const { q, seal } = counted();
		const json = MAX_PLAINTEXT_BYTES - 2;
		expect(
			code(() => sealRecord(q, recordKey, ctx, 1, { a: "x".repeat(json - 8) })),
		).toBe("invalid_input");
		expect(seal).not.toHaveBeenCalled();
		expect(
			code(() => sealRecord(q, recordKey, ctx, 1, { a: "x".repeat(json - 9) })),
		).toBe("none");
		expect(seal).toHaveBeenCalledTimes(1);
	});

	it("unwrapKey refuses a wrong-sized wrap before decrypting", () => {
		const { q, open } = counted();
		const w = wrapKey(p, bytes(32, 5), "ak-password", "u1", bytes(32, 9));
		const grown = Uint8Array.of(...w, 0);
		const cut = w.slice(0, w.length - 1);
		for (const wrong of [
			grown,
			cut,
			w.slice(0, 2),
			w.slice(0, 1),
			new Uint8Array(0),
		]) {
			expect(
				code(() => unwrapKey(q, bytes(32, 5), "ak-password", "u1", wrong)),
			).toBe("decrypt_failed");
		}
		expect(open).not.toHaveBeenCalled();
		// The twin: the right size does reach the cipher.
		expect(unwrapKey(q, bytes(32, 5), "ak-password", "u1", w)).toEqual(
			bytes(32, 9),
		);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("unwrapKey refuses an unknown version or kind before decrypting", () => {
		const { q, open } = counted();
		const w = wrapKey(p, bytes(32, 5), "ak-password", "u1", bytes(32, 9));
		for (const at of [0, 1]) {
			const changed = w.slice();
			changed[at] = 9;
			expect(
				code(() => unwrapKey(q, bytes(32, 5), "ak-password", "u1", changed)),
			).toBe("invalid_input");
		}
		expect(open).not.toHaveBeenCalled();
	});

	it("unwrapKeyFromPublic refuses a wrong-sized wrap before opening the box", () => {
		const open = vi.fn(p.sealOpen);
		const q = { ...p, sealOpen: open };
		const pair = p.boxKeypair();
		const w = wrapKeyToPublic(p, pair.publicKey, "ak-device", "d1", bytes(32));
		const grown = Uint8Array.of(...w, 0);
		for (const wrong of [grown, w.slice(0, w.length - 1), w.slice(0, 1)]) {
			expect(
				code(() => unwrapKeyFromPublic(q, pair, "ak-device", "d1", wrong)),
			).toBe("decrypt_failed");
		}
		expect(open).not.toHaveBeenCalled();
		expect(unwrapKeyFromPublic(q, pair, "ak-device", "d1", w)).toEqual(
			bytes(32),
		);
		expect(open).toHaveBeenCalledTimes(1);
	});
});
