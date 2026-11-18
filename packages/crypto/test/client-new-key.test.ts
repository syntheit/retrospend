// makeNewRecoveryKey and prepareNewRecoveryKey (src/client/new-key.ts) with the
// F3 vectors: a scripted source of randomness makes the new recovery key the
// vectors' own, so the proof and the text are known answers from a generator
// that shares no code with the package, and the wrap must open under the
// vector recovery wrap key. The password layer runs against a fake keys route
// holding the second master vector's account.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_FLOOR,
	fromBase64Url,
	fromHex,
	type Primitives,
	toBase64Url,
	toHex,
	unwrapKey,
	wrapKey,
} from "../src";
import {
	KeyFlowError,
	makeNewRecoveryKey,
	type NewKeyPorts,
	prepareNewRecoveryKey,
} from "../src/client";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
const RK = vectors.recoveryKeys[2];
if (!MASTER || !RK) throw new Error("vector missing");
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const seq = (n: number, start: number) =>
	Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);
const AK = seq(32, 0x20);
const allZero = (arrays: Uint8Array[]) =>
	arrays.every((b) => b.every((x) => x === 0));

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

/** Hands out the vector recovery key for the first 32-byte request. Everything else is real. */
function scripted(base: Primitives = p): Primitives {
	let first = true;
	return {
		...base,
		randomBytes: (n: number) => {
			if (n === 32 && first) {
				first = false;
				return Uint8Array.from(fromHex(RK?.recoveryKey as string));
			}
			return base.randomBytes(n);
		},
	};
}

const opensWith = (wrapped: string, wrapKeyHex: string) =>
	unwrapKey(
		p,
		fromHex(wrapKeyHex),
		"ak-recovery",
		USER_ID,
		fromBase64Url(wrapped) as Uint8Array,
	);

describe("makeNewRecoveryKey", () => {
	const input = () => ({
		userId: USER_ID,
		accountKey: Uint8Array.from(AK),
		baseVersion: 5,
	});

	it("makes the vector's proof and text, and a wrap that opens to the account key", () => {
		const { body, recoveryKeyText } = makeNewRecoveryKey(scripted(), input());
		expect(recoveryKeyText).toBe(RK.text);
		expect(body.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
		expect(body.baseVersion).toBe(5);
		expect(opensWith(body.wrappedRecoveryKey, RK.wrapKey)).toEqual(AK);
		expect(Object.keys(body).sort()).toEqual([
			"baseVersion",
			"recoveryAuthKey",
			"wrappedRecoveryKey",
		]);
	});

	it("binds the wrap to its role and the account", () => {
		const { body } = makeNewRecoveryKey(scripted(), input());
		const wrapped = fromBase64Url(body.wrappedRecoveryKey) as Uint8Array;
		const key = fromHex(RK.wrapKey);
		expect(() => unwrapKey(p, key, "ak-password", USER_ID, wrapped)).toThrow();
		expect(() =>
			unwrapKey(p, key, "ak-recovery", "someone-else", wrapped),
		).toThrow();
	});

	it("sends the proof, never its hash, its wrap key, the key or the account key", () => {
		const { body, recoveryKeyText } = makeNewRecoveryKey(scripted(), input());
		const text = JSON.stringify(body);
		expect(text).not.toContain(recoveryKeyText);
		for (const secret of [
			RK.recoveryKey,
			toBase64Url(fromHex(RK.wrapKey)),
			toBase64Url(fromHex(RK.authKeyHash)),
			toBase64Url(AK),
		])
			expect(text).not.toContain(secret);
	});

	it("makes a different key each time with real randomness", () => {
		const a = makeNewRecoveryKey(p, input());
		const b = makeNewRecoveryKey(p, input());
		expect(a.recoveryKeyText).not.toBe(b.recoveryKeyText);
		expect(a.body.recoveryAuthKey).not.toBe(b.body.recoveryAuthKey);
	});

	it("leaves the caller's account key alone", () => {
		const given = input();
		makeNewRecoveryKey(scripted(), given);
		expect(given.accountKey).toEqual(AK);
	});

	describe("before sending: nothing that does not open is returned", () => {
		const code = (prims: Primitives, given = input()) => {
			try {
				makeNewRecoveryKey(prims, given);
			} catch (e) {
				return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
			}
			return "none";
		};

		it("refuses a corrupted wrap", () => {
			const prims: Primitives = {
				...scripted(),
				aeadEncrypt: (key, nonce, plain, aad) => {
					const out = p.aeadEncrypt(key, nonce, plain, aad);
					out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			};
			expect(code(prims)).toBe("malformed");
		});

		it("refuses a wrap sealed as another role", () => {
			const prims: Primitives = {
				...scripted(),
				aeadEncrypt: (key, nonce, plain, aad) =>
					p.aeadEncrypt(
						key,
						nonce,
						plain,
						aad.replace("|ak-recovery|", "|private-key|"),
					),
			};
			expect(code(prims)).toBe("malformed");
		});

		it("refuses a wrap that opens to another account key", () => {
			const prims: Primitives = {
				...scripted(),
				aeadEncrypt: (key, nonce, _plain, aad) =>
					p.aeadEncrypt(key, nonce, seq(32, 0x99), aad),
			};
			expect(code(prims)).toBe("malformed");
		});

		it("refuses a proof that the written-down key does not make", () => {
			// kdfDerive runs: wrap key, proof, then the same two from the written
			// text. Damage the proof that is sent (the second).
			let n = 0;
			const prims: Primitives = {
				...scripted(),
				kdfDerive: (...args) => {
					const out = p.kdfDerive(...args);
					if (++n === 2) out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			};
			expect(code(prims)).toBe("malformed");
		});

		it("refuses a version that is not a whole number", () => {
			expect(code(scripted(), { ...input(), baseVersion: 1.5 })).toBe(
				"malformed",
			);
		});

		it("refuses an account key of the wrong size", () => {
			expect(code(scripted(), { ...input(), accountKey: seq(31, 1) })).toBe(
				"malformed",
			);
		});
	});

	describe("wiping", () => {
		function tracked(override: Partial<Primitives> = {}) {
			const kept: Uint8Array[] = [];
			const rkInputs: Uint8Array[] = [];
			const base = scripted();
			const prims: Primitives = {
				...base,
				randomBytes: (n) => {
					const out = base.randomBytes(n);
					if (n === 32) kept.push(out);
					return out;
				},
				kdfDerive: (key, id, context) => {
					if (toHex(key) === RK?.recoveryKey) rkInputs.push(key);
					const out = base.kdfDerive(key, id, context);
					kept.push(out);
					return out;
				},
				...override,
			};
			return { prims, kept, rkInputs };
		}

		it("wipes the recovery key, both subkeys and the copy read back from the text, on success", () => {
			const t = tracked();
			makeNewRecoveryKey(t.prims, {
				userId: USER_ID,
				accountKey: Uint8Array.from(AK),
				baseVersion: 1,
			});
			// the made key, four subkeys
			expect(t.kept.length).toBeGreaterThanOrEqual(5);
			expect(allZero(t.kept)).toBe(true);
			// Two derivations from the made key and two from the parsed copy: two
			// different arrays.
			expect(new Set(t.rkInputs).size).toBe(2);
			expect(allZero(t.rkInputs)).toBe(true);
		});

		it("wipes the same on a refused check", () => {
			const t = tracked({
				aeadEncrypt: (key, nonce, plain, aad) => {
					const out = p.aeadEncrypt(key, nonce, plain, aad);
					out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			});
			expect(() =>
				makeNewRecoveryKey(t.prims, {
					userId: USER_ID,
					accountKey: Uint8Array.from(AK),
					baseVersion: 1,
				}),
			).toThrow(KeyFlowError);
			expect(t.kept.length).toBeGreaterThanOrEqual(3);
			expect(allZero(t.kept)).toBe(true);
			expect(allZero(t.rkInputs)).toBe(true);
		});
	});
});

describe("prepareNewRecoveryKey (password in)", () => {
	const KDF = {
		salt: toBase64Url(fromHex(MASTER.salt)),
		memoryKiB: MASTER.memoryKiB,
		passes: MASTER.passes,
	};
	const passwordWrap = (id = USER_ID) =>
		toBase64Url(wrapKey(p, fromHex(MASTER.wrapKey), "ak-password", id, AK));
	const openAnswer = (over: Record<string, unknown> = {}) => ({
		version: 4,
		kdf: KDF,
		wraps: [
			{ role: "private-key", targetId: USER_ID, wrapped: "AAAA" },
			{ role: "ak-password", targetId: USER_ID, wrapped: passwordWrap() },
		],
		...over,
	});

	function rig(
		prims: Primitives = scripted(),
		server: {
			kdf?: () => unknown;
			missing?: boolean;
			open?: (body: { authKey: string }) => unknown;
		} = {},
	) {
		const opens: { authKey: string }[] = [];
		const ports = {
			primitives: vi.fn(async () => prims),
			paint: vi.fn(async () => {}),
			lookup: async () =>
				server.missing
					? { missing: true as const }
					: { body: { kdf: server.kdf ? server.kdf() : KDF } },
			lookupRoute: "keys" as const,
			open: vi.fn(async (body: { authKey: string }) => {
				opens.push(body);
				if (server.open) return server.open(body);
				if (body.authKey !== toBase64Url(fromHex(MASTER.authKey)))
					throw new KeyFlowError("wrongPassword");
				return openAnswer();
			}),
		} satisfies NewKeyPorts;
		const run = (password = MASTER.password) =>
			prepareNewRecoveryKey(ports, { userId: USER_ID, password });
		return { ports, opens, run };
	}

	it("sends the vector sign-in secret and returns the vector key, proof and version", async () => {
		const r = rig();
		const { body, recoveryKeyText } = await r.run();
		expect(r.opens).toEqual([
			{ authKey: toBase64Url(fromHex(MASTER.authKey)) },
		]);
		expect(body.currentAuthKey).toBe(toBase64Url(fromHex(MASTER.authKey)));
		expect(body.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
		expect(recoveryKeyText).toBe(RK.text);
		expect(body.baseVersion).toBe(4);
		expect(opensWith(body.wrappedRecoveryKey, RK.wrapKey)).toEqual(AK);
		expect(r.ports.paint).toHaveBeenCalledTimes(1);
	});

	it("gives wrongPassword when the server refuses the sign-in secret", async () => {
		await expect(rig().run("not the password")).rejects.toMatchObject({
			code: "wrongPassword",
		});
	});

	it("is a downgrade when the account has no keys", async () => {
		await expect(
			rig(scripted(), { missing: true }).run(),
		).rejects.toMatchObject({ code: "downgrade" });
	});

	it("refuses parameters outside the floor before the library loads", async () => {
		const r = rig(scripted(), {
			kdf: () => ({ ...KDF, memoryKiB: 1024, passes: 1 }),
		});
		await expect(r.run()).rejects.toMatchObject({ code: "params" });
		expect(r.ports.primitives).not.toHaveBeenCalled();
		expect(r.ports.open).not.toHaveBeenCalled();
	});

	it("is a conflict when the key set's kdf changed between the lookup and the open", async () => {
		const r = rig(scripted(), {
			open: () => openAnswer({ kdf: { ...KDF, passes: KDF.passes + 1 } }),
		});
		await expect(r.run()).rejects.toMatchObject({ code: "conflict" });
	});

	it("refuses a password wrap that does not open", async () => {
		const bytes = fromBase64Url(passwordWrap()) as Uint8Array;
		bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
		const r = rig(scripted(), {
			open: () =>
				openAnswer({
					wraps: [{ role: "ak-password", wrapped: toBase64Url(bytes) }],
				}),
		});
		await expect(r.run()).rejects.toMatchObject({ code: "malformed" });
	});

	it("refuses a password wrap bound to another account", async () => {
		const r = rig(scripted(), {
			open: () =>
				openAnswer({
					wraps: [
						{ role: "ak-password", wrapped: passwordWrap("someone-else") },
					],
				}),
		});
		await expect(r.run()).rejects.toMatchObject({ code: "malformed" });
	});

	it("is unavailable for an answer without exactly one ak-password wrap, or of the wrong shape", async () => {
		const wrap = { role: "ak-password", wrapped: passwordWrap() };
		for (const over of [
			{ wraps: [] },
			{ wraps: [wrap, wrap] },
			{ wraps: "x" },
			{ version: "4" },
			{ kdf: null },
		]) {
			const r = rig(scripted(), { open: () => openAnswer(over) });
			await expect(r.run()).rejects.toMatchObject({ code: "unavailable" });
		}
	});

	it("wipes the account key it opened and every key it derived, on success and on failure", async () => {
		for (const refuse of [false, true]) {
			const kept: Uint8Array[] = [];
			const base = scripted();
			const prims: Primitives = {
				...base,
				argon2id: (...a) => {
					const out = base.argon2id(...a);
					kept.push(out);
					return out;
				},
				kdfDerive: (...a) => {
					const out = base.kdfDerive(...a);
					kept.push(out);
					return out;
				},
				aeadDecrypt: (...a) => {
					const out = base.aeadDecrypt(...a);
					kept.push(out);
					return out;
				},
				aeadEncrypt: (key, nonce, plain, aad) => {
					const out = base.aeadEncrypt(key, nonce, plain, aad);
					if (refuse && aad.includes("|ak-recovery|"))
						out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			};
			const run = rig(prims).run();
			if (refuse) await expect(run).rejects.toBeInstanceOf(KeyFlowError);
			else await run;
			// master key, two subkeys, the account key, and the recovery subkeys.
			expect(kept.length).toBeGreaterThan(6);
			expect(allZero(kept)).toBe(true);
		}
	});

	it("derives with one Argon2id run, from the server's parameters", async () => {
		const argon = vi.fn(p.argon2id);
		await rig({ ...scripted(), argon2id: argon }).run();
		expect(argon).toHaveBeenCalledTimes(1);
		expect(argon.mock.calls[0]?.[2]).toEqual({
			memoryKiB: ARGON2_FLOOR.memoryKiB,
			passes: ARGON2_FLOOR.passes,
		});
	});
});
