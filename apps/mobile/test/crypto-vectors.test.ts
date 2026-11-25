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
	ARGON2_FLOOR,
	CryptoError,
	deriveMasterKey,
	encodeRecoveryKey,
	fingerprintPhrase,
	masterSubkeys,
	openRecord,
	type Primitives,
	parseRecoveryKey,
	type RecordContext,
	recoverySubkeys,
	sealRecord,
	TAG_BYTES,
	unwrapKey,
	wrapKey,
} from "@retrospend/crypto";
import { makeNewRecoveryKey, recoverAccount } from "@retrospend/crypto/client";
import { runKnownAnswerTests } from "@retrospend/crypto/dev";
import { unwrapKeyFromPublic, wrapKeyToPublic } from "@retrospend/crypto/k4";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
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

	it("seals a record, opens it, and refuses another place or a changed byte", () => {
		const key = p.randomBytes(32);
		const keyId = p.randomBytes(16);
		const ctx: RecordContext = {
			userId: "u1",
			collectionId: "c1",
			entity: 1,
			recordId: "r1",
			version: 1,
		};
		const find = () => key;
		const sealed = sealRecord(p, { keyId, key }, ctx, 1, {
			title: "Caf\u00e9",
		});
		expect(openRecord(p, find, ctx, sealed).record).toEqual({
			title: "Caf\u00e9",
		});
		expect(() =>
			openRecord(p, find, { ...ctx, recordId: "r2" }, sealed),
		).toThrow(CryptoError);
		sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
		expect(() => openRecord(p, find, ctx, sealed)).toThrow(CryptoError);
	});

	it("unlocks the account key by password, recovery key and device key pair", () => {
		const salt = p.randomBytes(16);
		const { wrapKey: pwKey } = masterSubkeys(
			p,
			deriveMasterKey(p, "caf\u00e9 passphrase", salt, ARGON2_FLOOR),
		);
		const ak = p.randomBytes(32);
		const recoveryKey = p.randomBytes(32);
		const pair = p.boxKeypair();
		const byPassword = wrapKey(p, pwKey, "ak-password", "u1", ak);
		const byRecovery = wrapKey(
			p,
			recoverySubkeys(p, recoveryKey).wrapKey,
			"ak-recovery",
			"u1",
			ak,
		);
		const byDevice = wrapKeyToPublic(p, pair.publicKey, "ak-device", "d1", ak);
		expect(unwrapKey(p, pwKey, "ak-password", "u1", byPassword)).toEqual(ak);
		expect(
			unwrapKey(
				p,
				recoverySubkeys(p, parseRecoveryKey(encodeRecoveryKey(recoveryKey)))
					.wrapKey,
				"ak-recovery",
				"u1",
				byRecovery,
			),
		).toEqual(ak);
		expect(unwrapKeyFromPublic(p, pair, "ak-device", "d1", byDevice)).toEqual(
			ak,
		);
		expect(() => unwrapKey(p, pwKey, "ak-recovery", "u1", byPassword)).toThrow(
			CryptoError,
		);
		expect(fingerprintPhrase(p, [pair.publicKey]).split(" ")).toHaveLength(6);
	});

	it("recovers with the vector recovery key and makes a new one, on the phone's primitives", async () => {
		const master = vectors.masters[1];
		const rk = vectors.recoveryKeys[2];
		if (!master || !rk) throw new Error("vector missing");
		const hex = (text: string) =>
			Uint8Array.from(text.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
		const userId = "0b1f2e3d-4c5b-4a69-8877-665544332211";
		const ak = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);
		const pair = p.boxKeypair();
		const text = (bytes: Uint8Array) =>
			Buffer.from(bytes).toString("base64url");
		const answer = {
			userId,
			version: 3,
			publicKey: text(pair.publicKey),
			wraps: [
				{
					role: "ak-recovery",
					wrapped: text(wrapKey(p, hex(rk.wrapKey), "ak-recovery", userId, ak)),
				},
				{
					role: "private-key",
					wrapped: text(wrapKey(p, ak, "private-key", userId, pair.privateKey)),
				},
			],
		};
		const salted: Primitives = {
			...p,
			randomBytes: (n) => (n === 16 ? hex(master.salt) : p.randomBytes(n)),
		};
		const proofs: string[] = [];
		const body = await recoverAccount(
			{
				primitives: async () => salted,
				begin: async (b) => {
					proofs.push(b.recoveryAuthKey);
					return answer;
				},
			},
			{ recoveryKeyText: rk.text, password: master.password },
			{ params: ARGON2_FLOOR },
		);
		expect(proofs).toEqual([text(hex(rk.authKey))]);
		expect(body.recoveryAuthKey).toBe(text(hex(rk.authKey)));
		expect(body.newAuthKey).toBe(text(hex(master.authKey)));
		expect(
			unwrapKey(
				p,
				hex(master.wrapKey),
				"ak-password",
				userId,
				Uint8Array.from(Buffer.from(body.wrappedAccountKey, "base64url")),
			),
		).toEqual(ak);

		const made = makeNewRecoveryKey(p, {
			userId,
			accountKey: ak,
			privateKeyWrap: wrapKey(p, ak, "private-key", userId, pair.privateKey),
			publicKey: pair.publicKey,
			baseVersion: 3,
		});
		const next = parseRecoveryKey(made.recoveryKeyText);
		expect(
			unwrapKey(
				p,
				recoverySubkeys(p, next).wrapKey,
				"ak-recovery",
				userId,
				Uint8Array.from(Buffer.from(made.body.wrappedRecoveryKey, "base64url")),
			),
		).toEqual(ak);
	});
});
