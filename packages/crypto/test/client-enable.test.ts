// prepareEnable (src/client/enable.ts) with the F3 vectors: a scripted source
// of randomness makes the salt and the recovery key the vectors' own, so the
// sign-in secret, the recovery proof and the recovery text are known answers
// from a generator that shares no code with the package.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_FLOOR,
	deriveMasterKey,
	encodeRecoveryKey,
	fromBase64Url,
	fromHex,
	keyPairMatches,
	masterSubkeys,
	type Primitives,
	parseRecoveryKey,
	recoverySubkeys,
	toBase64Url,
	toHex,
	unwrapKey,
} from "../src";
import {
	type EnableBody,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	prepareEnable,
} from "../src/client";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
const RK = vectors.recoveryKeys[2];
if (!MASTER || !RK) throw new Error("vector missing");
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const PASSWORD = MASTER.password;
const OPTIONS = { params: ARGON2_FLOOR };
const seq = (n: number, start: number) =>
	Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);
const AK = seq(32, 0x20);
const KEY_ID = seq(16, 0x50);
const COLLECTION = seq(32, 0x60);

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

/**
 * A source of randomness that hands out the vectors' bytes in the order
 * prepareEnable asks: salt, account key, recovery key, collection key id and
 * key, then one nonce for each of the four wraps. Anything after that is real.
 * Every array it hands out is kept, to see them wiped.
 */
function scripted(base: Primitives = p) {
	const queue = [
		fromHex(MASTER?.salt as string),
		AK,
		fromHex(RK?.recoveryKey as string),
		KEY_ID,
		COLLECTION,
	].map((b) => Uint8Array.from(b));
	const handed: Uint8Array[] = [];
	const prims: Primitives = {
		...base,
		randomBytes: (n) => {
			const next = queue.shift();
			const out = next ?? base.randomBytes(n);
			if (out.length !== n) throw new Error("script out of step");
			handed.push(out);
			return out;
		},
	};
	return { prims, handed };
}

const ports = (prims: Primitives) => ({
	primitives: vi.fn(async () => prims),
	paint: vi.fn(async () => {}),
});

const wrapOf = (body: EnableBody, role: string) =>
	body.wraps.find((w) => w.role === role);
const bytesOf = (text: string) => fromBase64Url(text) as Uint8Array;

describe("prepareEnable", () => {
	it("makes the vectors' sign-in secret, recovery proof and recovery text", async () => {
		const { prims } = scripted();
		const { body, recoveryKeyText } = await prepareEnable(
			ports(prims),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		expect(body.authKey).toBe(toBase64Url(fromHex(MASTER.authKey)));
		expect(body.kdf).toEqual({
			salt: toBase64Url(fromHex(MASTER.salt)),
			memoryKiB: ARGON2_FLOOR.memoryKiB,
			passes: ARGON2_FLOOR.passes,
		});
		expect(body.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
		expect(recoveryKeyText).toBe(RK.text);
	});

	it("sends the recovery proof, never its hash, its wrap key or the key", async () => {
		const { prims } = scripted();
		const { body } = await prepareEnable(
			ports(prims),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		const sent = toHex(bytesOf(body.recoveryAuthKey));
		expect(sent).toBe(RK.authKey);
		expect(sent).not.toBe(RK.authKeyHash);
		expect(sent).not.toBe(RK.wrapKey);
		expect(sent).not.toBe(RK.recoveryKey);
	});

	it("sends four wraps that open from what the person will have", async () => {
		const { prims } = scripted();
		const { body, recoveryKeyText } = await prepareEnable(
			ports(prims),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		expect(body.wraps.map((w) => w.role)).toEqual([
			"ak-password",
			"ak-recovery",
			"private-key",
			"collection-key",
		]);
		// The password alone, with the salt and parameters as sent.
		const { wrapKey: passwordWrapKey } = masterSubkeys(
			p,
			deriveMasterKey(p, PASSWORD, bytesOf(body.kdf.salt), body.kdf),
		);
		const viaPassword = unwrapKey(
			p,
			passwordWrapKey,
			"ak-password",
			USER_ID,
			bytesOf((wrapOf(body, "ak-password") ?? { wrapped: "" }).wrapped),
		);
		expect(toHex(passwordWrapKey)).toBe(MASTER.wrapKey);
		expect(viaPassword).toEqual(AK);
		const viaRecovery = unwrapKey(
			p,
			recoverySubkeys(p, parseRecoveryKey(recoveryKeyText)).wrapKey,
			"ak-recovery",
			USER_ID,
			bytesOf((wrapOf(body, "ak-recovery") ?? { wrapped: "" }).wrapped),
		);
		expect(viaRecovery).toEqual(AK);
		const privateKey = unwrapKey(
			p,
			AK,
			"private-key",
			USER_ID,
			bytesOf((wrapOf(body, "private-key") ?? { wrapped: "" }).wrapped),
		);
		expect(
			keyPairMatches(p, { publicKey: bytesOf(body.publicKey), privateKey }),
		).toBe(true);
		const collection = wrapOf(body, "collection-key");
		expect(collection?.targetId).toBe(toHex(KEY_ID));
		expect(
			unwrapKey(
				p,
				AK,
				"collection-key",
				toHex(KEY_ID),
				bytesOf(collection?.wrapped ?? ""),
			),
		).toEqual(COLLECTION);
		for (const w of body.wraps) {
			if (w.role !== "collection-key") expect(w.targetId).toBe(USER_ID);
		}
	});

	it("binds each wrap to its role and to the account", async () => {
		const { prims } = scripted();
		const { body } = await prepareEnable(
			ports(prims),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		const recoveryWrap = bytesOf(
			(wrapOf(body, "ak-recovery") ?? { wrapped: "" }).wrapped,
		);
		const wrapKey = recoverySubkeys(p, fromHex(RK.recoveryKey)).wrapKey;
		expect(() =>
			unwrapKey(p, wrapKey, "private-key", USER_ID, recoveryWrap),
		).toThrow();
		expect(() =>
			unwrapKey(p, wrapKey, "ak-recovery", "someone-else", recoveryWrap),
		).toThrow();
		// A flipped byte in any wrap role stops it opening.
		for (const w of body.wraps) {
			const bad = bytesOf(w.wrapped);
			bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
			const key = w.role === "ak-password" ? fromHex(MASTER.wrapKey) : wrapKey;
			expect(() => unwrapKey(p, key, w.role, w.targetId, bad)).toThrow();
		}
	});

	it("uses the default parameters unless a test says otherwise, and one Argon2id run", async () => {
		const argon = vi.fn(p.argon2id);
		await prepareEnable(ports({ ...p, argon2id: argon }), {
			userId: USER_ID,
			password: PASSWORD,
		});
		expect(argon).toHaveBeenCalledTimes(1);
		expect(argon.mock.calls[0]?.[2]).toEqual(NEW_PASSWORD_PARAMS);
	});

	it("refuses parameters outside the floor before the library loads", async () => {
		const t = ports(p);
		await expect(
			prepareEnable(
				t,
				{ userId: USER_ID, password: PASSWORD },
				{ params: { memoryKiB: 1024, passes: 1 } },
			),
		).rejects.toMatchObject({ code: "params" });
		expect(t.primitives).not.toHaveBeenCalled();
	});

	it("paints once before the Argon2id run, and sends nothing but text", async () => {
		const t = ports(scripted().prims);
		const { body, recoveryKeyText } = await prepareEnable(
			t,
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		expect(t.paint).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(body)).not.toContain(PASSWORD);
		expect(JSON.stringify(body)).not.toContain(recoveryKeyText);
		expect(JSON.stringify(body)).not.toContain(MASTER.masterKey);
	});

	it("makes a different recovery key and salt each time with real randomness", async () => {
		const a = await prepareEnable(
			ports(p),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		const b = await prepareEnable(
			ports(p),
			{ userId: USER_ID, password: PASSWORD },
			OPTIONS,
		);
		expect(a.recoveryKeyText).not.toBe(b.recoveryKeyText);
		expect(a.body.kdf.salt).not.toBe(b.body.kdf.salt);
		expect(a.body.recoveryAuthKey).not.toBe(b.body.recoveryAuthKey);
		expect(encodeRecoveryKey(parseRecoveryKey(a.recoveryKeyText))).toBe(
			a.recoveryKeyText,
		);
	});

	describe("before sending: nothing that does not open is returned", () => {
		/** Seals as p does, but damages what `damage` says for the wrap whose AAD names `role`. */
		const damaged = (
			role: string,
			damage: (out: Uint8Array) => void,
		): Primitives => ({
			...scripted().prims,
			aeadEncrypt: (key, nonce, plain, aad) => {
				const out = p.aeadEncrypt(key, nonce, plain, aad);
				if (aad.includes(`|${role}|`)) damage(out);
				return out;
			},
		});
		const flip = (out: Uint8Array) => {
			out[0] = (out[0] ?? 0) ^ 1;
		};

		it.each(["ak-password", "ak-recovery", "private-key", "collection-key"])(
			"refuses a corrupted %s wrap",
			async (role) => {
				await expect(
					prepareEnable(
						ports(damaged(role, flip)),
						{ userId: USER_ID, password: PASSWORD },
						OPTIONS,
					),
				).rejects.toMatchObject({ code: "malformed" });
			},
		);

		it("refuses an ak-recovery wrap sealed as another role", async () => {
			const prims: Primitives = {
				...scripted().prims,
				aeadEncrypt: (key, nonce, plain, aad) =>
					p.aeadEncrypt(
						key,
						nonce,
						plain,
						aad.replace("|ak-recovery|", "|private-key|"),
					),
			};
			await expect(
				prepareEnable(
					ports(prims),
					{ userId: USER_ID, password: PASSWORD },
					OPTIONS,
				),
			).rejects.toMatchObject({ code: "malformed" });
		});

		it("refuses an ak-recovery wrap that opens to another account key", async () => {
			const prims: Primitives = {
				...scripted().prims,
				aeadEncrypt: (key, nonce, plain, aad) =>
					p.aeadEncrypt(
						key,
						nonce,
						aad.includes("|ak-recovery|") ? seq(32, 0x99) : plain,
						aad,
					),
			};
			await expect(
				prepareEnable(
					ports(prims),
					{ userId: USER_ID, password: PASSWORD },
					OPTIONS,
				),
			).rejects.toMatchObject({ code: "malformed" });
		});

		it("refuses a private key that is not the public key's pair", async () => {
			const stranger = p.boxKeypair();
			const real = scripted();
			const prims: Primitives = {
				...real.prims,
				boxKeypair: () => {
					const mine = p.boxKeypair();
					return {
						publicKey: mine.publicKey,
						privateKey: stranger.privateKey,
					};
				},
			};
			await expect(
				prepareEnable(
					ports(prims),
					{ userId: USER_ID, password: PASSWORD },
					OPTIONS,
				),
			).rejects.toMatchObject({ code: "malformed" });
		});

		it("refuses a recovery proof that the written-down key does not make", async () => {
			// kdfDerive runs: password auth, password wrap, recovery wrap,
			// recovery auth, then the same two from the written text. Damage the
			// recovery auth key that is sent (the fourth).
			let n = 0;
			const prims: Primitives = {
				...scripted().prims,
				kdfDerive: (...args) => {
					const out = p.kdfDerive(...args);
					if (++n === 4) out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			};
			await expect(
				prepareEnable(
					ports(prims),
					{ userId: USER_ID, password: PASSWORD },
					OPTIONS,
				),
			).rejects.toMatchObject({ code: "malformed" });
		});
	});

	describe("wiping", () => {
		const allZero = (arrays: Uint8Array[]) =>
			arrays.every((b) => b.every((x) => x === 0));

		it("wipes the salt, the account key, the recovery key and the collection key after a run", async () => {
			const s = scripted();
			await prepareEnable(
				ports(s.prims),
				{ userId: USER_ID, password: PASSWORD },
				OPTIONS,
			);
			const [salt, ak, rk, keyId, collection] = s.handed;
			expect(allZero([salt, ak, rk, collection] as Uint8Array[])).toBe(true);
			// The key id is public (it names the collection key) and is not wiped.
			expect(keyId?.some((x) => x !== 0)).toBe(true);
		});

		it("wipes every derived key too, on success and on a refused check", async () => {
			for (const refuse of [false, true]) {
				const kept: Uint8Array[] = [];
				const track = (b: Uint8Array) => {
					kept.push(b);
					return b;
				};
				const base = scripted().prims;
				const prims: Primitives = {
					...base,
					argon2id: (...a) => track(base.argon2id(...a)),
					kdfDerive: (...a) => track(base.kdfDerive(...a)),
					aeadDecrypt: (...a) => track(base.aeadDecrypt(...a)),
					boxKeypair: () => {
						const pair = base.boxKeypair();
						track(pair.privateKey);
						return pair;
					},
					aeadEncrypt: (key, nonce, plain, aad) => {
						const out = base.aeadEncrypt(key, nonce, plain, aad);
						if (refuse && aad.includes("|ak-recovery|"))
							out[0] = (out[0] ?? 0) ^ 1;
						return out;
					},
				};
				const run = prepareEnable(
					ports(prims),
					{ userId: USER_ID, password: PASSWORD },
					OPTIONS,
				);
				if (refuse) await expect(run).rejects.toBeInstanceOf(KeyFlowError);
				else await run;
				expect(kept.length).toBeGreaterThan(4);
				expect(allZero(kept)).toBe(true);
			}
		});
	});
});
