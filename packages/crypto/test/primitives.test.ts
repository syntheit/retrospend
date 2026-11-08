// Primitives on the web/Node build of libsodium. The known-answer vectors are
// shared with the phone (apps/mobile/test/crypto-vectors.test.ts).
import { argon2Sync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	CryptoError,
	fromHex,
	KEY_BYTES,
	NONCE_BYTES,
	type Primitives,
	runKnownAnswerTests,
	SEAL_OVERHEAD_BYTES,
	TAG_BYTES,
	toHex,
} from "../src";
import { createWebPrimitives, loadWebSodium } from "../src/web";
import vectors from "../vectors/primitives.vectors.json";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const bytes = (n: number, start = 0) =>
	Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return e instanceof CryptoError ? e.code : "other";
	}
	return "none";
};

describe("known answers", () => {
	it("every vector matches", () => {
		expect(runKnownAnswerTests(p)).toEqual([]);
	});

	it("the self-test reports a build that disagrees", () => {
		const broken: Primitives = {
			...p,
			blake2b: (m, l, k) => {
				const out = p.blake2b(m, l, k);
				out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		};
		expect(runKnownAnswerTests(broken)).toContain("blake2b: abc, 32 bytes");
	});

	it("libsodium reproduces the IETF XChaCha20-Poly1305 vector (binary AAD)", async () => {
		const v = vectors.xchachaDraft;
		const sodium = await loadWebSodium();
		const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			fromHex(v.plaintext),
			fromHex(v.aadHex),
			null,
			fromHex(v.nonce),
			fromHex(v.key),
		);
		expect(toHex(ct)).toBe(v.ciphertext);
	});

	it("Argon2id agrees with OpenSSL on inputs the vectors do not cover", () => {
		for (const [pw, memoryKiB, passes] of [
			["a", 64, 1],
			["a longer pass phrase with spaces", 512, 3],
		] as const) {
			const password = new TextEncoder().encode(pw);
			const salt = bytes(16, 7);
			const expected = argon2Sync("argon2id", {
				message: password,
				nonce: salt,
				parallelism: 1,
				tagLength: 32,
				memory: memoryKiB,
				passes,
			});
			expect(toHex(p.argon2id(password, salt, { memoryKiB, passes }))).toBe(
				expected.toString("hex"),
			);
		}
	});
});

describe("aead", () => {
	const key = bytes(KEY_BYTES, 1);
	const nonce = bytes(NONCE_BYTES, 100);
	const aad = "rs.v1|user|coll|1|record|3";
	const message = new TextEncoder().encode("amount=1234;currency=ARS");
	const sealed = () => p.aeadEncrypt(key, nonce, message, aad);

	it("round-trips every length around the block size, with a random nonce", () => {
		for (const n of [0, 1, 15, 16, 17, 63, 64, 65, 1000]) {
			const plain = bytes(n, 3);
			const n24 = p.randomBytes(NONCE_BYTES);
			const ct = p.aeadEncrypt(key, n24, plain, aad);
			expect(ct.length).toBe(n + TAG_BYTES);
			expect(p.aeadDecrypt(key, n24, ct, aad)).toEqual(plain);
		}
	});

	it("rejects a change to any single byte of the ciphertext or tag", () => {
		const ct = sealed();
		for (let i = 0; i < ct.length; i++) {
			const t = ct.slice();
			t[i] = (t[i] ?? 0) ^ 0x01;
			expect(code(() => p.aeadDecrypt(key, nonce, t, aad))).toBe(
				"decrypt_failed",
			);
		}
	});

	it("rejects a wrong key, nonce or AAD (one character off)", () => {
		const ct = sealed();
		expect(code(() => p.aeadDecrypt(bytes(KEY_BYTES, 2), nonce, ct, aad))).toBe(
			"decrypt_failed",
		);
		expect(
			code(() => p.aeadDecrypt(key, bytes(NONCE_BYTES, 101), ct, aad)),
		).toBe("decrypt_failed");
		expect(
			code(() => p.aeadDecrypt(key, nonce, ct, "rs.v1|user|coll|1|record|4")),
		).toBe("decrypt_failed");
		expect(code(() => p.aeadDecrypt(key, nonce, ct, ""))).toBe(
			"decrypt_failed",
		);
	});

	it("rejects truncated, extended and empty input", () => {
		const ct = sealed();
		for (const t of [
			ct.slice(0, ct.length - 1),
			ct.slice(0, TAG_BYTES - 1),
			ct.slice(0, TAG_BYTES),
			new Uint8Array(0),
			Uint8Array.from([...ct, 0]),
			Uint8Array.from([0, ...ct]),
		]) {
			expect(code(() => p.aeadDecrypt(key, nonce, t, aad))).toBe(
				"decrypt_failed",
			);
		}
	});

	it("refuses malformed arguments without echoing them", () => {
		const secret = "never-log-this";
		expect(code(() => p.aeadEncrypt(bytes(31), nonce, message, aad))).toBe(
			"invalid_input",
		);
		expect(code(() => p.aeadEncrypt(key, bytes(12), message, aad))).toBe(
			"invalid_input",
		);
		expect(code(() => p.aeadEncrypt(key, nonce, message, "café"))).toBe(
			"invalid_input",
		);
		expect(code(() => p.aeadEncrypt(key, nonce, message, "a\u0000b"))).toBe(
			"invalid_input",
		);
		try {
			p.aeadEncrypt(key, nonce, message, `${secret}é`);
		} catch (e) {
			expect(String(e) + JSON.stringify(e)).not.toContain(secret);
		}
	});
});

describe("argon2id and kdf", () => {
	const password = new TextEncoder().encode("pw");
	const salt = bytes(16);

	it("depends on password, salt, memory and passes", () => {
		const base = toHex(
			p.argon2id(password, salt, { memoryKiB: 64, passes: 1 }),
		);
		const other = (pw: Uint8Array, s: Uint8Array, m: number, t: number) =>
			toHex(p.argon2id(pw, s, { memoryKiB: m, passes: t }));
		expect(other(new TextEncoder().encode("pX"), salt, 64, 1)).not.toBe(base);
		expect(other(password, bytes(16, 1), 64, 1)).not.toBe(base);
		expect(other(password, salt, 128, 1)).not.toBe(base);
		expect(other(password, salt, 64, 2)).not.toBe(base);
	});

	it("rejects out-of-range parameters", () => {
		const at = (memoryKiB: number, passes: number, s = salt) =>
			code(() => p.argon2id(password, s, { memoryKiB, passes }));
		expect(at(7, 1)).toBe("invalid_input");
		expect(at(64, 0)).toBe("invalid_input");
		expect(at(64.5, 1)).toBe("invalid_input");
		expect(at(2 * 1024 * 1024, 1)).toBe("invalid_input");
		expect(at(64, 1, bytes(15))).toBe("invalid_input");
		expect(
			code(() =>
				p.argon2id(new Uint8Array(0), salt, { memoryKiB: 64, passes: 1 }),
			),
		).toBe("invalid_input");
	});

	it("separates subkeys by id and by context, and checks its arguments", () => {
		const mk = bytes(KEY_BYTES);
		const a = toHex(p.kdfDerive(mk, 1, "rs.auth!"));
		expect(toHex(p.kdfDerive(mk, 1, "rs.auth!"))).toBe(a);
		expect(toHex(p.kdfDerive(mk, 2, "rs.auth!"))).not.toBe(a);
		expect(toHex(p.kdfDerive(mk, 1, "rs.wrap!"))).not.toBe(a);
		expect(code(() => p.kdfDerive(mk, 1, "short"))).toBe("invalid_input");
		expect(code(() => p.kdfDerive(mk, -1, "rs.auth!"))).toBe("invalid_input");
		expect(code(() => p.kdfDerive(mk, 2 ** 31, "rs.auth!"))).toBe(
			"invalid_input",
		);
		expect(code(() => p.kdfDerive(bytes(16), 1, "rs.auth!"))).toBe(
			"invalid_input",
		);
	});

	it("blake2b is keyed when given a key", () => {
		const m = bytes(10);
		expect(toHex(p.blake2b(m, 32))).not.toBe(
			toHex(p.blake2b(m, 32, bytes(32))),
		);
		expect(code(() => p.blake2b(m, 8))).toBe("invalid_input");
	});
});

describe("sealed boxes", () => {
	it("round-trips, adds the documented overhead and varies per seal", () => {
		const pair = p.boxKeypair();
		const m = bytes(32, 9);
		const a = p.seal(m, pair.publicKey);
		const b = p.seal(m, pair.publicKey);
		expect(a.length).toBe(m.length + SEAL_OVERHEAD_BYTES);
		expect(toHex(a)).not.toBe(toHex(b));
		expect(p.sealOpen(a, pair.publicKey, pair.privateKey)).toEqual(m);
	});

	it("rejects another recipient, a changed byte and short input", () => {
		const pair = p.boxKeypair();
		const other = p.boxKeypair();
		const ct = p.seal(bytes(32), pair.publicKey);
		expect(code(() => p.sealOpen(ct, other.publicKey, other.privateKey))).toBe(
			"decrypt_failed",
		);
		for (let i = 0; i < ct.length; i++) {
			const t = ct.slice();
			t[i] = (t[i] ?? 0) ^ 0x80;
			expect(code(() => p.sealOpen(t, pair.publicKey, pair.privateKey))).toBe(
				"decrypt_failed",
			);
		}
		expect(
			code(() => p.sealOpen(ct.slice(0, 47), pair.publicKey, pair.privateKey)),
		).toBe("decrypt_failed");
	});

	it("derives the same key pair from a seed and a different one from another", () => {
		const a = p.boxKeypairFromSeed(bytes(32));
		expect(toHex(p.boxKeypairFromSeed(bytes(32)).publicKey)).toBe(
			toHex(a.publicKey),
		);
		expect(toHex(p.boxKeypairFromSeed(bytes(32, 1)).publicKey)).not.toBe(
			toHex(a.publicKey),
		);
		expect(code(() => p.boxKeypairFromSeed(bytes(31)))).toBe("invalid_input");
	});
});

describe("helpers", () => {
	it("draws distinct random bytes of the requested length", () => {
		const a = p.randomBytes(32);
		expect(a.length).toBe(32);
		expect(toHex(a)).not.toBe(toHex(p.randomBytes(32)));
		expect(code(() => p.randomBytes(0))).toBe("invalid_input");
	});

	it("refuses malformed hex with the package's error", () => {
		expect(code(() => fromHex("zz"))).toBe("invalid_input");
		expect(code(() => fromHex("abc"))).toBe("invalid_input");
	});

	it("wipes in place", () => {
		const k = bytes(8, 1);
		p.wipe(k);
		expect(k).toEqual(new Uint8Array(8));
	});
});
