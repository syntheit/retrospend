// The key hierarchy on the web/Node build. The known answers in
// vectors/keys.vectors.json (made by scripts/gen-keys.mjs, which uses no
// libsodium and none of keys.ts) run through runKnownAnswerTests and so also
// on the phone (apps/mobile/test/crypto-vectors.test.ts).
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_CEILING,
	ARGON2_DEFAULT,
	ARGON2_FLOOR,
	CryptoError,
	checkArgon2Params,
	deriveMasterKey,
	encodeProquint,
	encodeRecoveryKey,
	fingerprintPhrase,
	fromHex,
	generateAccountKey,
	generateCollectionKey,
	generateRecoveryKey,
	keyPairMatches,
	masterSubkeys,
	openRecord,
	type Primitives,
	type PublicRole,
	parseRecoveryKey,
	recoveryWrapKey,
	runKnownAnswerTests,
	type SymmetricRole,
	sealRecord,
	toHex,
	unwrapKey,
	unwrapKeyFromPublic,
	wrapKey,
	wrapKeyToPublic,
} from "../src";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

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
const salt = bytes(16, 5);
const FLOOR = ARGON2_FLOOR;

describe("known answers", () => {
	it("every vector matches", () => {
		expect(runKnownAnswerTests(p)).toEqual([]);
	});

	it("the self-test reports a build whose key derivation disagrees", () => {
		const broken: Primitives = {
			...p,
			kdfDerive: (...args) => {
				const out = p.kdfDerive(...args);
				out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		};
		const failures = runKnownAnswerTests(broken);
		expect(failures).toContain(`master subkeys: ${vectors.masters[0]?.name}`);
		expect(failures).toContain(
			`recovery wrap key: ${vectors.recoveryKeys[0]?.name}`,
		);
	});

	it("the self-test reports a build whose fingerprint hash disagrees", () => {
		const broken: Primitives = {
			...p,
			blake2b: (m, l, k) => {
				const out = p.blake2b(m, l, k);
				out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		};
		const failures = runKnownAnswerTests(broken);
		expect(failures).toContain("fingerprint: one key");
		expect(failures).toContain("unwrap from public: ak-device");
	});
});

describe("argon2 parameters", () => {
	it("accepts the default, the floor and the ceiling", () => {
		for (const params of [ARGON2_DEFAULT, ARGON2_FLOOR, ARGON2_CEILING]) {
			expect(checkArgon2Params(params)).toBe(params);
		}
	});

	it("refuses anything weaker than the floor or beyond the ceiling", () => {
		const weak = [
			{ memoryKiB: FLOOR.memoryKiB - 1, passes: 3 },
			{ memoryKiB: 19 * 1024, passes: 2 },
			{ memoryKiB: 64 * 1024, passes: 0 },
			{ memoryKiB: 8, passes: 1 },
			{ memoryKiB: ARGON2_CEILING.memoryKiB + 1, passes: 3 },
			{ memoryKiB: 64 * 1024, passes: ARGON2_CEILING.passes + 1 },
			{ memoryKiB: 64 * 1024 + 0.5, passes: 3 },
			{ memoryKiB: 64 * 1024, passes: Number.NaN },
		];
		for (const params of weak) {
			expect(code(() => checkArgon2Params(params))).toBe("invalid_input");
		}
	});

	it("deriveMasterKey refuses weak parameters before it runs Argon2", () => {
		const argon2id = vi.fn(p.argon2id);
		const spy: Primitives = { ...p, argon2id };
		expect(
			code(() =>
				deriveMasterKey(spy, "pw", salt, { memoryKiB: 19 * 1024, passes: 2 }),
			),
		).toBe("invalid_input");
		expect(argon2id).not.toHaveBeenCalled();
		deriveMasterKey(spy, "pw", salt, FLOOR);
		expect(argon2id).toHaveBeenCalledTimes(1);
	});

	it("refuses a salt of the wrong length, an empty password and a lone surrogate", () => {
		expect(code(() => deriveMasterKey(p, "pw", bytes(15), FLOOR))).toBe(
			"invalid_input",
		);
		expect(code(() => deriveMasterKey(p, "", salt, FLOOR))).toBe(
			"invalid_input",
		);
		expect(code(() => deriveMasterKey(p, "a\ud800b", salt, FLOOR))).toBe(
			"invalid_input",
		);
	});
});

describe("master key and subkeys", () => {
	it("treats equivalent Unicode spellings of a password as one password", () => {
		const composed = toHex(deriveMasterKey(p, "café Ａ", salt, FLOOR));
		for (const same of ["café A", "café A", "café Ａ"]) {
			expect(toHex(deriveMasterKey(p, same, salt, FLOOR))).toBe(composed);
		}
		expect(toHex(deriveMasterKey(p, "cafe A", salt, FLOOR))).not.toBe(composed);
	});

	it("depends on the salt and on the parameters", () => {
		const base = toHex(deriveMasterKey(p, "pw", salt, FLOOR));
		expect(toHex(deriveMasterKey(p, "pw", bytes(16, 6), FLOOR))).not.toBe(base);
		expect(
			toHex(deriveMasterKey(p, "pw", salt, { ...FLOOR, passes: 2 })),
		).not.toBe(base);
	});

	it("derives an auth key and a wrapping key that are independent of each other and of MK", () => {
		const mk = deriveMasterKey(p, "pw", salt, FLOOR);
		const a = masterSubkeys(p, mk);
		const b = masterSubkeys(p, mk);
		expect(a).toEqual(b);
		const all = [toHex(mk), toHex(a.authKey), toHex(a.wrapKey)];
		expect(new Set(all).size).toBe(3);
	});

	it("keeps the recovery context apart from the master context", () => {
		const k = bytes(32, 9);
		expect(toHex(recoveryWrapKey(p, k))).not.toBe(
			toHex(masterSubkeys(p, k).wrapKey),
		);
		expect(toHex(recoveryWrapKey(p, k))).not.toBe(
			toHex(masterSubkeys(p, k).authKey),
		);
	});
});

const symmetric: [SymmetricRole, string][] = [
	["ak-password", "user_1"],
	["ak-recovery", "user_1"],
	["collection-key", "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"],
	["private-key", "user_1"],
];

describe("symmetric wraps", () => {
	const wrapping = bytes(32, 1);
	const key = bytes(32, 100);

	it("round-trips for every role and uses a fresh nonce each time", () => {
		for (const [role, id] of symmetric) {
			const a = wrapKey(p, wrapping, role, id, key);
			const b = wrapKey(p, wrapping, role, id, key);
			expect(a.length).toBe(74);
			expect(toHex(a)).not.toBe(toHex(b));
			expect(unwrapKey(p, wrapping, role, id, a)).toEqual(key);
		}
	});

	it("fails for another role, another id or another wrapping key", () => {
		const wrapped = wrapKey(p, wrapping, "collection-key", "k1", key);
		for (const [role, id, w] of [
			["private-key", "k1", wrapping],
			["collection-key", "k2", wrapping],
			["collection-key", "k1", bytes(32, 2)],
		] as const) {
			expect(code(() => unwrapKey(p, w, role, id, wrapped))).toBe(
				"decrypt_failed",
			);
		}
	});

	it("fails for a change to any byte after the header, and for any length change", () => {
		const wrapped = wrapKey(p, wrapping, "ak-password", "u1", key);
		for (let i = 2; i < wrapped.length; i++) {
			const t = wrapped.slice();
			t[i] = (t[i] ?? 0) ^ 1;
			expect(code(() => unwrapKey(p, wrapping, "ak-password", "u1", t))).toBe(
				"decrypt_failed",
			);
		}
		for (const t of [
			wrapped.slice(0, -1),
			wrapped.slice(0, 2),
			wrapped.slice(0, 1),
			new Uint8Array(0),
			Uint8Array.from([...wrapped, 0]),
		]) {
			expect(code(() => unwrapKey(p, wrapping, "ak-password", "u1", t))).toBe(
				"decrypt_failed",
			);
		}
	});

	it("refuses a version or algorithm it does not know", () => {
		const wrapped = wrapKey(p, wrapping, "ak-password", "u1", key);
		for (const i of [0, 1]) {
			const t = wrapped.slice();
			t[i] = 9;
			expect(code(() => unwrapKey(p, wrapping, "ak-password", "u1", t))).toBe(
				"invalid_input",
			);
		}
	});

	it("refuses a wrap that was sealed to a public key", () => {
		const pair = p.boxKeypair();
		const toPublic = wrapKeyToPublic(p, pair.publicKey, "ak-device", "d1", key);
		expect(
			code(() => unwrapKey(p, wrapping, "ak-password", "d1", toPublic)),
		).toBe("invalid_input");
	});

	it("refuses a bad role, id or key length", () => {
		const wrapped = wrapKey(p, wrapping, "ak-password", "u1", key);
		const asRole = (r: string) => r as SymmetricRole;
		expect(
			code(() => wrapKey(p, wrapping, asRole("ak-device"), "u1", key)),
		).toBe("invalid_input");
		expect(code(() => wrapKey(p, wrapping, asRole("nope"), "u1", key))).toBe(
			"invalid_input",
		);
		for (const id of ["", "a|b", "a b", "é", "x".repeat(65)]) {
			expect(code(() => wrapKey(p, wrapping, "ak-password", id, key))).toBe(
				"invalid_input",
			);
			expect(
				code(() => unwrapKey(p, wrapping, "ak-password", id, wrapped)),
			).toBe("invalid_input");
		}
		expect(
			code(() => wrapKey(p, wrapping, "ak-password", "u1", bytes(31))),
		).toBe("invalid_input");
		expect(code(() => wrapKey(p, bytes(31), "ak-password", "u1", key))).toBe(
			"invalid_input",
		);
	});
});

describe("wraps to a public key", () => {
	const key = bytes(32, 50);

	it("round-trips for each role", () => {
		const r = p.boxKeypair();
		for (const role of ["ak-device", "ak-contact"] as PublicRole[]) {
			const wrapped = wrapKeyToPublic(p, r.publicKey, role, "id_1", key);
			expect(wrapped.length).toBe(98);
			expect(unwrapKeyFromPublic(p, r, role, "id_1", wrapped)).toEqual(key);
		}
	});

	it("fails for another role, another id or another key pair", () => {
		const r = p.boxKeypair();
		const wrapped = wrapKeyToPublic(p, r.publicKey, "ak-device", "d1", key);
		expect(
			code(() => unwrapKeyFromPublic(p, r, "ak-contact", "d1", wrapped)),
		).toBe("decrypt_failed");
		expect(
			code(() => unwrapKeyFromPublic(p, r, "ak-device", "d2", wrapped)),
		).toBe("decrypt_failed");
		expect(
			code(() =>
				unwrapKeyFromPublic(p, p.boxKeypair(), "ak-device", "d1", wrapped),
			),
		).toBe("decrypt_failed");
	});

	it("fails for a changed byte or length", () => {
		const r = p.boxKeypair();
		const wrapped = wrapKeyToPublic(p, r.publicKey, "ak-device", "d1", key);
		for (let i = 2; i < wrapped.length; i++) {
			const t = wrapped.slice();
			t[i] = (t[i] ?? 0) ^ 1;
			expect(code(() => unwrapKeyFromPublic(p, r, "ak-device", "d1", t))).toBe(
				"decrypt_failed",
			);
		}
		for (const t of [
			wrapped.slice(0, -1),
			wrapped.slice(0, 2),
			new Uint8Array(1),
		]) {
			expect(code(() => unwrapKeyFromPublic(p, r, "ak-device", "d1", t))).toBe(
				"decrypt_failed",
			);
		}
		const bad = wrapped.slice();
		bad[1] = 1;
		expect(code(() => unwrapKeyFromPublic(p, r, "ak-device", "d1", bad))).toBe(
			"invalid_input",
		);
	});

	it("fails for a box someone sealed without the role and id binding", () => {
		const r = p.boxKeypair();
		const raw = p.seal(key, r.publicKey);
		const forged = Uint8Array.from([1, 2, ...raw]);
		expect(
			code(() => unwrapKeyFromPublic(p, r, "ak-device", "d1", forged)),
		).toBe("decrypt_failed");
		const noBinding = Uint8Array.from([
			1,
			2,
			...p.seal(new Uint8Array(48), r.publicKey),
		]);
		expect(
			code(() => unwrapKeyFromPublic(p, r, "ak-device", "d1", noBinding)),
		).toBe("decrypt_failed");
	});

	it("refuses a symmetric role, a bad id and a bad public key", () => {
		const r = p.boxKeypair();
		const asRole = (x: string) => x as PublicRole;
		expect(
			code(() =>
				wrapKeyToPublic(p, r.publicKey, asRole("ak-password"), "d1", key),
			),
		).toBe("invalid_input");
		expect(
			code(() => wrapKeyToPublic(p, r.publicKey, "ak-device", "d|1", key)),
		).toBe("invalid_input");
		expect(
			code(() => wrapKeyToPublic(p, bytes(31), "ak-device", "d1", key)),
		).toBe("invalid_input");
	});

	it("keyPairMatches tells a real pair from a swapped public key", () => {
		const a = p.boxKeypair();
		const b = p.boxKeypair();
		expect(keyPairMatches(p, a)).toBe(true);
		expect(
			keyPairMatches(p, { publicKey: b.publicKey, privateKey: a.privateKey }),
		).toBe(false);
		expect(
			keyPairMatches(p, { publicKey: a.publicKey, privateKey: bytes(32) }),
		).toBe(false);
	});
});

describe("recovery key text", () => {
	const random = () => {
		const keys = [new Uint8Array(32), new Uint8Array(32).fill(255)];
		for (let i = 0; i < 10; i++) keys.push(generateRecoveryKey(p));
		return keys;
	};

	it("is nine groups of six characters from the Crockford alphabet", () => {
		for (const key of random()) {
			const text = encodeRecoveryKey(key);
			expect(text).toMatch(
				/^[0-9A-HJKMNP-TV-Z]{6}(-[0-9A-HJKMNP-TV-Z]{6}){8}$/,
			);
			expect(parseRecoveryKey(text)).toEqual(key);
		}
	});

	it("reads lowercase, spaces, missing hyphens and the Crockford look-alikes", () => {
		const key = generateRecoveryKey(p);
		const text = encodeRecoveryKey(key);
		const flat = text.replaceAll("-", "");
		expect(parseRecoveryKey(flat.toLowerCase())).toEqual(key);
		expect(parseRecoveryKey(` ${text.replaceAll("-", "  ")}\n`)).toEqual(key);
		const lookalike = flat.replaceAll("0", "O").replaceAll("1", "l");
		expect(parseRecoveryKey(lookalike)).toEqual(key);
	});

	it("catches every single wrong character", () => {
		let tried = 0;
		for (const key of random()) {
			const flat = encodeRecoveryKey(key).replaceAll("-", "");
			const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
			for (let i = 0; i < flat.length; i++) {
				for (const ch of alphabet) {
					if (ch === flat[i]) continue;
					const typo = flat.slice(0, i) + ch + flat.slice(i + 1);
					expect(code(() => parseRecoveryKey(typo))).toBe("invalid_input");
					tried++;
				}
			}
		}
		expect(tried).toBe(12 * 54 * 31);
	});

	it("catches every swap of two neighbouring characters", () => {
		let tried = 0;
		for (const key of random()) {
			const flat = encodeRecoveryKey(key).replaceAll("-", "");
			for (let i = 0; i + 1 < flat.length; i++) {
				if (flat[i] === flat[i + 1]) continue;
				const swapped = `${flat.slice(0, i)}${flat[i + 1]}${flat[i]}${flat.slice(i + 2)}`;
				expect(code(() => parseRecoveryKey(swapped))).toBe("invalid_input");
				tried++;
			}
		}
		expect(tried).toBeGreaterThan(12 * 40);
	});

	it("refuses a missing, extra or foreign character", () => {
		const flat = encodeRecoveryKey(generateRecoveryKey(p)).replaceAll("-", "");
		for (const text of [
			flat.slice(1),
			flat.slice(0, -1),
			`${flat}0`,
			"",
			`${flat.slice(0, 5)}U${flat.slice(6)}`,
			`${flat.slice(0, 5)}é${flat.slice(6)}`,
			`${flat.slice(0, 5)}*${flat.slice(6)}`,
		]) {
			expect(code(() => parseRecoveryKey(text))).toBe("invalid_input");
		}
		expect(code(() => encodeRecoveryKey(bytes(31)))).toBe("invalid_input");
	});

	it("refuses a version it does not know, even with correct check symbols", () => {
		// Rebuild the check symbols by hand (log tables, not the Horner form).
		const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
		const exp: number[] = [];
		let v = 1;
		for (let i = 0; i < 31; i++) {
			exp.push(v);
			v <<= 1;
			if (v & 32) v ^= 0b100101;
		}
		const mul = (a: number, b: number) =>
			a === 0 || b === 0
				? 0
				: (exp[(exp.indexOf(a) + exp.indexOf(b)) % 31] as number);
		const flat = encodeRecoveryKey(bytes(32)).replaceAll("-", "");
		const data = [...flat.slice(0, 52)].map((c) => alphabet.indexOf(c));
		data[51] = (data[51] as number) ^ 3; // version nibble 1 becomes 2
		let c1 = 0;
		let c2 = 0;
		data.forEach((d, i) => {
			c1 ^= d;
			c2 ^= mul(exp[i % 31] as number, d);
		});
		const forged = [...data, c1, c2].map((s) => alphabet[s]).join("");
		expect(code(() => parseRecoveryKey(forged))).toBe("invalid_input");
		// The same construction with the right version parses, so the test can fail.
		data[51] = (data[51] as number) ^ 3;
		let d1 = 0;
		let d2 = 0;
		data.forEach((d, i) => {
			d1 ^= d;
			d2 ^= mul(exp[i % 31] as number, d);
		});
		const good = [...data, d1, d2].map((s) => alphabet[s]).join("");
		expect(parseRecoveryKey(good)).toEqual(bytes(32));
	});
});

describe("fingerprint phrase", () => {
	it("is six words of five letters, the same every time", () => {
		const a = p.boxKeypair().publicKey;
		const phrase = fingerprintPhrase(p, [a]);
		expect(phrase).toMatch(
			/^([bdfghjklmnprstvz][aiou]){2}[bdfghjklmnprstvz]( |$)/,
		);
		expect(phrase.split(" ")).toHaveLength(6);
		expect(fingerprintPhrase(p, [a])).toBe(phrase);
	});

	it("changes with one bit of the key, with the key order, and with the key count", () => {
		const a = bytes(32, 1);
		const b = bytes(32, 2);
		const flipped = a.slice();
		flipped[31] = (flipped[31] ?? 0) ^ 1;
		const phrases = [
			fingerprintPhrase(p, [a]),
			fingerprintPhrase(p, [flipped]),
			fingerprintPhrase(p, [a, b]),
			fingerprintPhrase(p, [b, a]),
		];
		expect(new Set(phrases).size).toBe(4);
	});

	it("refuses no keys, a short key and odd proquint input", () => {
		expect(code(() => fingerprintPhrase(p, []))).toBe("invalid_input");
		expect(code(() => fingerprintPhrase(p, [bytes(31)]))).toBe("invalid_input");
		expect(code(() => encodeProquint(bytes(3)))).toBe("invalid_input");
		expect(code(() => encodeProquint(new Uint8Array(0)))).toBe("invalid_input");
	});

	it("encodes the proquint reference examples", () => {
		for (const [hex, words] of Object.entries(vectors.proquint)) {
			expect(encodeProquint(fromHex(hex)).join("-")).toBe(words);
		}
	});
});

describe("the whole hierarchy", () => {
	it("unlocks the same keys by password, by recovery key and by device", () => {
		const userId = "user_1";
		const mk = deriveMasterKey(p, "a long passphrase", salt, FLOOR);
		const { wrapKey: pwKey } = masterSubkeys(p, mk);
		const ak = generateAccountKey(p);
		const recoveryKey = generateRecoveryKey(p);
		const pair = p.boxKeypair();
		const collection = generateCollectionKey(p);
		const keyIdHex = toHex(collection.keyId);

		// What the server would store.
		const wraps = {
			byPassword: wrapKey(p, pwKey, "ak-password", userId, ak),
			byRecovery: wrapKey(
				p,
				recoveryWrapKey(p, recoveryKey),
				"ak-recovery",
				userId,
				ak,
			),
			byDevice: wrapKeyToPublic(p, pair.publicKey, "ak-device", "device_1", ak),
			privateKey: wrapKey(p, ak, "private-key", userId, pair.privateKey),
			collection: wrapKey(p, ak, "collection-key", keyIdHex, collection.key),
		};
		const ctx = {
			userId,
			collectionId: "coll_1",
			entity: 1,
			recordId: "rec_1",
			version: 1,
		};
		const sealed = sealRecord(p, collection, ctx, 1, { title: "Coffee" });

		// Unlock three ways; each reaches the same AK and so the same data.
		const text = encodeRecoveryKey(recoveryKey);
		const viaPassword = unwrapKey(
			p,
			pwKey,
			"ak-password",
			userId,
			wraps.byPassword,
		);
		const viaRecovery = unwrapKey(
			p,
			recoveryWrapKey(p, parseRecoveryKey(text)),
			"ak-recovery",
			userId,
			wraps.byRecovery,
		);
		const priv = unwrapKey(
			p,
			viaPassword,
			"private-key",
			userId,
			wraps.privateKey,
		);
		const viaDevice = unwrapKeyFromPublic(
			p,
			{ publicKey: pair.publicKey, privateKey: priv },
			"ak-device",
			"device_1",
			wraps.byDevice,
		);
		for (const unlocked of [viaPassword, viaRecovery, viaDevice]) {
			expect(unlocked).toEqual(ak);
			const collectionKey = unwrapKey(
				p,
				unlocked,
				"collection-key",
				keyIdHex,
				wraps.collection,
			);
			expect(openRecord(p, () => collectionKey, ctx, sealed).record).toEqual({
				title: "Coffee",
			});
		}
		expect(
			keyPairMatches(p, { publicKey: pair.publicKey, privateKey: priv }),
		).toBe(true);

		// The wrong password does not unlock.
		const wrong = masterSubkeys(
			p,
			deriveMasterKey(p, "another passphrase", salt, FLOOR),
		);
		expect(
			code(() =>
				unwrapKey(p, wrong.wrapKey, "ak-password", userId, wraps.byPassword),
			),
		).toBe("decrypt_failed");
	});
});

describe("errors carry no key material", () => {
	it("every failure has one of the fixed messages", () => {
		const secret = bytes(32, 77);
		const secretHex = toHex(secret);
		const pair = p.boxKeypair();
		const wrapped = wrapKey(p, secret, "ak-password", "user_secret_id", secret);
		const attempts: (() => unknown)[] = [
			() =>
				deriveMasterKey(p, "hunter2-secret", salt, { memoryKiB: 8, passes: 1 }),
			() => deriveMasterKey(p, "", salt, FLOOR),
			() => unwrapKey(p, bytes(32), "ak-password", "user_secret_id", wrapped),
			() => unwrapKey(p, secret, "private-key", "user_secret_id", wrapped),
			() => unwrapKey(p, secret, "ak-password", "bad|id", wrapped),
			() => wrapKey(p, secret, "ak-password", "user_secret_id", bytes(5)),
			() =>
				unwrapKeyFromPublic(p, pair, "ak-device", "device_secret_id", wrapped),
			() => parseRecoveryKey(`${encodeRecoveryKey(secret).slice(0, 20)}ZZZ`),
			() => encodeRecoveryKey(bytes(5)),
		];
		for (const attempt of attempts) {
			try {
				attempt();
				throw new Error("should have thrown");
			} catch (e) {
				expect(e).toBeInstanceOf(CryptoError);
				const message = (e as CryptoError).message;
				expect(["Invalid cryptographic input", "Decryption failed"]).toContain(
					message,
				);
				for (const leak of [secretHex, "hunter2", "secret_id", "ZZZ"]) {
					expect(message).not.toContain(leak);
				}
			}
		}
	});
});
