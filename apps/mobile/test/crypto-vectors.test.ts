// The crypto known-answer vectors from @retrospend/crypto, run through the
// phone's adapter (src/crypto/native.ts) in jest. Same JSON as web vitest.
//
// Jest cannot load the native module, so react-native-libsodium is replaced
// by libsodium.js, which has the same API. That proves our wrapper, the
// adapter's wiring and the vectors under the mobile toolchain. It does NOT
// prove the native build: run the same vectors on a real device (they are
// exported as runKnownAnswerTests for the benchmark screen) before relying
// on it.
import {
	CryptoError,
	type Primitives,
	runKnownAnswerTests,
	TAG_BYTES,
} from "@retrospend/crypto";
import { loadWebSodium } from "@retrospend/crypto/web";

let p: Primitives;

beforeAll(async () => {
	const sodium = await loadWebSodium();
	// Spread after ready: libsodium.js fills its exports when it loads.
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	const { getPrimitives } =
		require("../src/crypto/native") as typeof import("../src/crypto/native");
	p = await getPrimitives();
});

describe("crypto vectors on the phone toolchain", () => {
	it("every vector matches", () => {
		expect(runKnownAnswerTests(p)).toEqual([]);
	});

	it("seals and opens, and refuses a changed byte", () => {
		const key = p.randomBytes(32);
		const nonce = p.randomBytes(24);
		const message = Uint8Array.from([1, 2, 3, 4, 5]);
		const ct = p.aeadEncrypt(key, nonce, message, "rs.test|1");
		expect(ct.length).toBe(message.length + TAG_BYTES);
		expect(p.aeadDecrypt(key, nonce, ct, "rs.test|1")).toEqual(message);
		ct[0] = (ct[0] ?? 0) ^ 1;
		expect(() => p.aeadDecrypt(key, nonce, ct, "rs.test|1")).toThrow(
			CryptoError,
		);
	});

	it("opens a box sealed to a derived key pair", () => {
		const pair = p.boxKeypairFromSeed(p.randomBytes(32));
		const message = p.randomBytes(32);
		const sealed = p.seal(message, pair.publicKey);
		expect(p.sealOpen(sealed, pair.publicKey, pair.privateKey)).toEqual(
			message,
		);
	});
});
