// recoverAccount (src/client/recover.ts) against a fake server behind the
// begin port, with the F3 vectors: the recovery key is the vectors' own, so
// the proof it sends is the known recovery auth key; the salt is scripted, so
// the new sign-in secret is the second master vector's known auth key, and the
// new password wrap must open under that vector's known wrap key. The server's
// two wraps are made here under the vector recovery wrap key.
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
	beginRecovery,
	finishRecovery,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	type RecoverBody,
	type RecoverPorts,
	recoverAccount,
} from "../src/client";
import { wrapKeyWithNonce } from "../src/keys";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

// A spy over the package's own wipe, passing through, to see the one wipe the
// core does itself (when the primitives cannot load, no bin exists yet).
vi.mock("../src/primitives", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/primitives")>();
	return { ...actual, wipe: vi.fn(actual.wipe) };
});

const MASTER = vectors.masters[1];
const RK = vectors.recoveryKeys[2];
const OTHER_RK = vectors.recoveryKeys[3];
if (!MASTER || !RK || !OTHER_RK) throw new Error("vector missing");
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const NEW_PASSWORD = MASTER.password;
const OPTIONS = { params: ARGON2_FLOOR };
const seq = (n: number, start: number) =>
	Uint8Array.from({ length: n }, (_, i) => (start + i) & 255);
const AK = seq(32, 0x20);

let p: Primitives;
let pair: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
	p = await createWebPrimitives();
	pair = p.boxKeypair();
});

/** Hands out the vector's salt for the one 16-byte request; everything else is real. */
function scripted(base: Primitives = p) {
	const handed: Uint8Array[] = [];
	const prims: Primitives = {
		...base,
		randomBytes: (n) => {
			const out =
				n === 16
					? Uint8Array.from(fromHex(MASTER?.salt as string))
					: base.randomBytes(n);
			handed.push(out);
			return out;
		},
	};
	return { prims, handed };
}

type Answer = Record<string, unknown>;
/** What a server holding the vector's account answers once the proof passed. */
function goodAnswer(overrides: Partial<Answer> = {}): Answer {
	const nonce = seq(24, 0x41);
	return {
		userId: USER_ID,
		version: 7,
		publicKey: toBase64Url(pair.publicKey),
		wraps: [
			{
				role: "ak-recovery",
				targetId: USER_ID,
				wrapped: toBase64Url(
					wrapKeyWithNonce(
						p,
						fromHex(RK?.wrapKey as string),
						"ak-recovery",
						USER_ID,
						AK,
						nonce,
					),
				),
			},
			{
				role: "private-key",
				targetId: USER_ID,
				wrapped: toBase64Url(
					wrapKey(p, AK, "private-key", USER_ID, pair.privateKey),
				),
			},
		],
		...overrides,
	};
}

const setWrap = (answer: Answer, role: string, wrapped: string): Answer => ({
	...answer,
	wraps: (answer.wraps as { role: string; targetId: string }[]).map((w) =>
		w.role === role ? { ...w, wrapped } : w,
	),
});
const wrapOf = (answer: Answer, role: string) =>
	(answer.wraps as { role: string; wrapped: string }[]).find(
		(w) => w.role === role,
	)?.wrapped as string;
const flipped = (text: string) => {
	const bytes = fromBase64Url(text) as Uint8Array;
	bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
	return toBase64Url(bytes);
};

/** A server that checks the proof against the vector's recovery auth key, as the real one checks the hash. */
function rig(prims: Primitives, answer: Answer | (() => Answer) = goodAnswer) {
	const begins: { recoveryAuthKey: string }[] = [];
	const ports = {
		primitives: vi.fn(async () => prims),
		paint: vi.fn(async () => {}),
		begin: vi.fn(async (body: { recoveryAuthKey: string }) => {
			begins.push(body);
			if (
				toHex(fromBase64Url(body.recoveryAuthKey) as Uint8Array) !== RK?.authKey
			)
				throw new KeyFlowError("wrongRecoveryKey");
			return typeof answer === "function" ? answer() : answer;
		}),
	} satisfies RecoverPorts;
	return { ports, begins };
}

const run = (
	ports: RecoverPorts,
	text: string = RK.text,
	options: Parameters<typeof recoverAccount>[2] = OPTIONS,
) =>
	recoverAccount(
		ports,
		{ recoveryKeyText: text, password: NEW_PASSWORD },
		options,
	);

const codeOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

describe("recoverAccount", () => {
	it("sends the vector proof and returns the vector-derived sign-in secret, kdf and version", async () => {
		const r = rig(scripted().prims);
		const body = await run(r.ports);
		expect(r.begins).toEqual([
			{ recoveryAuthKey: toBase64Url(fromHex(RK.authKey)) },
		]);
		expect(body.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
		expect(body.newAuthKey).toBe(toBase64Url(fromHex(MASTER.authKey)));
		expect(body.kdf).toEqual({
			salt: toBase64Url(fromHex(MASTER.salt)),
			memoryKiB: ARGON2_FLOOR.memoryKiB,
			passes: ARGON2_FLOOR.passes,
		});
		expect(body.baseVersion).toBe(7);
		expect(Object.keys(body).sort()).toEqual([
			"baseVersion",
			"kdf",
			"newAuthKey",
			"recoveryAuthKey",
			"wrappedAccountKey",
		]);
	});

	it("rewraps the same account key under the new password, bound to the account", async () => {
		const body = await run(rig(scripted().prims).ports);
		const wrapped = fromBase64Url(body.wrappedAccountKey) as Uint8Array;
		const wrapKeyBytes = fromHex(MASTER.wrapKey);
		expect(unwrapKey(p, wrapKeyBytes, "ak-password", USER_ID, wrapped)).toEqual(
			AK,
		);
		expect(() =>
			unwrapKey(p, wrapKeyBytes, "ak-password", "someone-else", wrapped),
		).toThrow();
		expect(() =>
			unwrapKey(p, wrapKeyBytes, "ak-recovery", USER_ID, wrapped),
		).toThrow();
	});

	it("reads the key the way a person types it", async () => {
		const typed = RK.text.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
		const body = await run(rig(scripted().prims).ports, typed);
		expect(body.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
	});

	it("sends and returns nothing but text, and never the key, its wrap key or the password", async () => {
		const body = await run(rig(scripted().prims).ports);
		const text = JSON.stringify(body);
		for (const secret of [
			RK.recoveryKey,
			RK.wrapKey,
			RK.text,
			NEW_PASSWORD,
			MASTER.masterKey,
			MASTER.wrapKey,
			toBase64Url(AK),
			toBase64Url(fromHex(RK.wrapKey)),
		])
			expect(text).not.toContain(secret);
	});

	it("uses the default parameters unless a test says otherwise, with one Argon2id run, after painting", async () => {
		const argon = vi.fn(p.argon2id);
		const r = rig({ ...p, argon2id: argon });
		await run(r.ports, RK.text, {});
		expect(argon).toHaveBeenCalledTimes(1);
		expect(argon.mock.calls[0]?.[2]).toEqual(NEW_PASSWORD_PARAMS);
		expect(r.ports.paint).toHaveBeenCalledTimes(1);
	});

	it("refuses parameters outside the floor before the library loads or the server is asked", async () => {
		const r = rig(p);
		await expect(
			run(r.ports, RK.text, { params: { memoryKiB: 1024, passes: 1 } }),
		).rejects.toMatchObject({ code: "params" });
		expect(r.ports.primitives).not.toHaveBeenCalled();
		expect(r.ports.begin).not.toHaveBeenCalled();
	});

	describe("the key text", () => {
		const typos: [string, string][] = [
			[
				"a single symbol changed",
				`${RK.text.slice(0, 3)}${RK.text[3] === "1" ? "2" : "1"}${RK.text.slice(4)}`,
			],
			[
				"two adjacent symbols swapped",
				`${RK.text.slice(0, 7)}${RK.text[8]}${RK.text[7]}${RK.text.slice(9)}`,
			],
			["a group missing", RK.text.split("-").slice(1).join("-")],
			["empty", ""],
			["a stray character", `${RK.text.slice(0, 5)}!${RK.text.slice(6)}`],
			["a character that is not ASCII", `${RK.text}é`],
		];

		it.each(typos)(
			"refuses %s as a typo, with nothing sent and no library",
			async (_name, text) => {
				expect(typos.find(([n]) => n === _name)?.[1]).not.toBe(RK.text);
				const r = rig(p);
				await expect(run(r.ports, text)).rejects.toMatchObject({
					code: "typo",
				});
				expect(r.ports.primitives).not.toHaveBeenCalled();
				expect(r.ports.begin).not.toHaveBeenCalled();
			},
		);

		it("gives wrongRecoveryKey for a valid key that is not this account's, and returns no body", async () => {
			const r = rig(scripted().prims);
			expect(OTHER_RK.text).not.toBe(RK.text);
			await expect(run(r.ports, OTHER_RK.text)).rejects.toMatchObject({
				code: "wrongRecoveryKey",
			});
			expect(r.begins).toHaveLength(1);
		});

		it("refuses a server that answers a wrong key's proof with wraps anyway", async () => {
			// A hostile or broken server: the other key's wrap key cannot open them.
			const r = rig(scripted().prims);
			r.ports.begin.mockImplementation(async () => goodAnswer());
			expect(await codeOf(run(r.ports, OTHER_RK.text))).toBe("malformed");
		});
	});

	describe("before sending: a body is returned only when everything opens", () => {
		const returned = async (answer: Answer) => {
			const r = rig(scripted().prims, answer);
			let body: RecoverBody | undefined;
			const code = await codeOf(
				run(r.ports).then((b) => {
					body = b;
				}),
			);
			return { code, body };
		};

		it("refuses a flipped byte in the ak-recovery wrap", async () => {
			const answer = goodAnswer();
			const bad = setWrap(
				answer,
				"ak-recovery",
				flipped(wrapOf(answer, "ak-recovery")),
			);
			expect(await returned(bad)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses a flipped byte in the private-key wrap", async () => {
			const answer = goodAnswer();
			const bad = setWrap(
				answer,
				"private-key",
				flipped(wrapOf(answer, "private-key")),
			);
			expect(await returned(bad)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses wraps bound to another account", async () => {
			const answer = goodAnswer();
			const other = "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
			const wraps = [
				{
					role: "ak-recovery",
					wrapped: toBase64Url(
						wrapKey(p, fromHex(RK.wrapKey), "ak-recovery", other, AK),
					),
				},
				{
					role: "private-key",
					wrapped: toBase64Url(
						wrapKey(p, AK, "private-key", other, pair.privateKey),
					),
				},
			];
			// The server names the account the wraps were not made for.
			expect(await returned({ ...answer, wraps })).toEqual({
				code: "malformed",
				body: undefined,
			});
			// Only the account key's wrap is for another account.
			const half = setWrap(answer, "ak-recovery", wraps[0]?.wrapped as string);
			expect(await returned(half)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses the two wraps given as each other's role", async () => {
			const answer = goodAnswer();
			const swapped = setWrap(
				setWrap(answer, "ak-recovery", wrapOf(answer, "private-key")),
				"private-key",
				wrapOf(answer, "ak-recovery"),
			);
			expect(await returned(swapped)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses a private key of another key pair, before any body exists", async () => {
			const stranger = p.boxKeypair();
			const answer = setWrap(
				goodAnswer(),
				"private-key",
				toBase64Url(
					wrapKey(p, AK, "private-key", USER_ID, stranger.privateKey),
				),
			);
			expect(await returned(answer)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses a public key of another pair", async () => {
			const answer = goodAnswer({
				publicKey: toBase64Url(p.boxKeypair().publicKey),
			});
			expect(await returned(answer)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses a public key of the wrong length", async () => {
			const answer = goodAnswer({ publicKey: toBase64Url(seq(31, 1)) });
			expect(await returned(answer)).toEqual({
				code: "malformed",
				body: undefined,
			});
		});

		it("refuses a new password wrap that would not open", async () => {
			const base = scripted().prims;
			const prims: Primitives = {
				...base,
				aeadEncrypt: (key, nonce, plain, aad) => {
					const out = base.aeadEncrypt(key, nonce, plain, aad);
					if (aad.includes("|ak-password|")) out[0] = (out[0] ?? 0) ^ 1;
					return out;
				},
			};
			const r = rig(prims);
			await expect(run(r.ports)).rejects.toMatchObject({ code: "malformed" });
		});

		it("refuses a new password wrap sealed to another account key", async () => {
			const base = scripted().prims;
			const prims: Primitives = {
				...base,
				aeadEncrypt: (key, nonce, plain, aad) =>
					base.aeadEncrypt(
						key,
						nonce,
						aad.includes("|ak-password|") ? seq(32, 0x99) : plain,
						aad,
					),
			};
			await expect(run(rig(prims).ports)).rejects.toMatchObject({
				code: "malformed",
			});
		});
	});

	describe("the server's answer", () => {
		const wrapsOf = () => goodAnswer().wraps as unknown[];
		const shapes: [string, () => Answer][] = [
			["a missing ak-recovery wrap", () => ({ wraps: [wrapsOf()[1]] })],
			["a missing private-key wrap", () => ({ wraps: [wrapsOf()[0]] })],
			[
				"two ak-recovery wraps",
				() => ({ wraps: [...wrapsOf(), wrapsOf()[0]] }),
			],
			["wraps that are not a list", () => ({ wraps: "x" })],
			["no user id", () => ({ userId: "" })],
			["a version that is not a whole number", () => ({ version: 1.5 })],
			["no public key", () => ({ publicKey: 3 })],
		];
		it.each(shapes)("is unavailable with %s", async (_name, patch) => {
			const r = rig(scripted().prims, goodAnswer(patch()));
			await expect(run(r.ports)).rejects.toMatchObject({ code: "unavailable" });
		});

		it("is unavailable for an answer that is not an object", async () => {
			const r = rig(scripted().prims, null as unknown as Answer);
			await expect(run(r.ports)).rejects.toMatchObject({ code: "unavailable" });
		});
	});

	describe("wiping", () => {
		it("wipes the parsed key when the primitives cannot be loaded, and gives up", async () => {
			const { wipe } = await import("../src/primitives");
			const seen: string[] = [];
			const real = vi.mocked(wipe).getMockImplementation() as (
				b: Uint8Array,
			) => void;
			vi.mocked(wipe).mockImplementation((b) => {
				seen.push(toHex(b));
				real(b);
			});
			const handed: Uint8Array[] = [];
			vi.mocked(wipe).mockClear();
			const begin = vi.fn();
			try {
				await expect(
					recoverAccount(
						{
							primitives: async () => {
								throw new Error("no library");
							},
							begin,
						},
						{ recoveryKeyText: RK.text, password: NEW_PASSWORD },
						OPTIONS,
					),
				).rejects.toMatchObject({ code: "failed" });
				handed.push(...vi.mocked(wipe).mock.calls.map(([b]) => b));
			} finally {
				vi.mocked(wipe).mockImplementation(real);
			}
			expect(begin).not.toHaveBeenCalled();
			// One array, holding the key as it was parsed, zero now.
			expect(seen).toEqual([RK.recoveryKey]);
			expect(handed).toHaveLength(1);
			expect(handed[0]?.every((x) => x === 0)).toBe(true);
		});

		const allZero = (arrays: Uint8Array[]) =>
			arrays.every((b) => b.every((x) => x === 0));

		/** Primitives that keep every secret array they hand out, and the arrays the recovery key text became. */
		function tracked(override: Partial<Primitives> = {}) {
			const kept: Uint8Array[] = [];
			const rkInputs: Uint8Array[] = [];
			const track = (b: Uint8Array) => {
				kept.push(b);
				return b;
			};
			const base = scripted().prims;
			const prims: Primitives = {
				...base,
				// The salt is the only secret it asks for (nonces and probes are public).
				randomBytes: (n) =>
					n === 16 ? track(base.randomBytes(n)) : base.randomBytes(n),
				argon2id: (...a) => track(base.argon2id(...a)),
				kdfDerive: (key, id, context) => {
					if (toHex(key) === RK?.recoveryKey) rkInputs.push(key);
					return track(base.kdfDerive(key, id, context));
				},
				aeadDecrypt: (...a) => track(base.aeadDecrypt(...a)),
				...override,
			};
			return { prims, kept, rkInputs };
		}

		it("wipes every key, the salt and the copy of the recovery key it read, on success", async () => {
			const t = tracked();
			await run(rig(t.prims).ports);
			// parsed copy, account key and private key, the salt, the master key
			// and its two subkeys, both recovery subkeys.
			expect(t.kept.length).toBeGreaterThan(7);
			expect(allZero(t.kept)).toBe(true);
			expect(t.rkInputs.length).toBeGreaterThan(0);
			expect(allZero(t.rkInputs)).toBe(true);
		});

		const failures: [
			string,
			(t: ReturnType<typeof tracked>) => RecoverPorts,
		][] = [
			[
				"the server refusing the proof",
				(t) => {
					const r = rig(t.prims);
					r.ports.begin.mockRejectedValue(new KeyFlowError("wrongRecoveryKey"));
					return r.ports;
				},
			],
			[
				"an ak-recovery wrap that does not open",
				(t) => {
					const a = goodAnswer();
					return rig(
						t.prims,
						setWrap(a, "ak-recovery", flipped(wrapOf(a, "ak-recovery"))),
					).ports;
				},
			],
			[
				"a private key of another pair",
				(t) =>
					rig(
						t.prims,
						setWrap(
							goodAnswer(),
							"private-key",
							toBase64Url(
								wrapKey(
									p,
									AK,
									"private-key",
									USER_ID,
									p.boxKeypair().privateKey,
								),
							),
						),
					).ports,
			],
			[
				"a new wrap that does not open",
				(t) => {
					const base = t.prims;
					return rig({
						...base,
						aeadEncrypt: (key, nonce, plain, aad) => {
							const out = p.aeadEncrypt(key, nonce, plain, aad);
							if (aad.includes("|ak-password|")) out[0] = (out[0] ?? 0) ^ 1;
							return out;
						},
					}).ports;
				},
			],
		];
		it.each(failures)(
			"wipes everything made when it stops at %s",
			async (_name, make) => {
				const t = tracked();
				const ports = make(t);
				await expect(run(ports)).rejects.toBeInstanceOf(KeyFlowError);
				expect(t.kept.length).toBeGreaterThan(0);
				expect(allZero(t.kept)).toBe(true);
				expect(t.rkInputs.length).toBeGreaterThan(0);
				expect(allZero(t.rkInputs)).toBe(true);
			},
		);
	});
});

describe("beginRecovery and finishRecovery", () => {
	const allZero = (arrays: Uint8Array[]) =>
		arrays.every((b) => b.every((x) => x === 0));

	it("proves the key before any new password exists, and derives nothing from a password yet", async () => {
		const argon = vi.fn(p.argon2id);
		const r = rig({ ...scripted().prims, argon2id: argon });
		const draft = await beginRecovery(r.ports, { recoveryKeyText: RK.text });
		expect(r.begins).toHaveLength(1);
		expect(argon).not.toHaveBeenCalled();
		draft.wipe();
	});

	it("a wrong key stops at the first step with no draft and no password asked for", async () => {
		const r = rig(scripted().prims);
		await expect(
			beginRecovery(r.ports, { recoveryKeyText: OTHER_RK.text }),
		).rejects.toMatchObject({ code: "wrongRecoveryKey" });
	});

	it("finishes to the same body as the one-call flow", async () => {
		const one = await run(rig(scripted().prims).ports);
		const r = rig(scripted().prims);
		const draft = await beginRecovery(r.ports, { recoveryKeyText: RK.text });
		const two = await finishRecovery(
			r.ports,
			draft,
			{ password: NEW_PASSWORD },
			OPTIONS,
		);
		draft.wipe();
		// The wrap's nonce is random, so the wraps differ as text; both open to the same key.
		const { wrappedAccountKey: wrapOne, ...restOne } = one;
		const { wrappedAccountKey: wrapTwo, ...restTwo } = two;
		expect(restTwo).toEqual(restOne);
		for (const wrapped of [wrapOne, wrapTwo])
			expect(
				unwrapKey(
					p,
					fromHex(MASTER.wrapKey),
					"ak-password",
					USER_ID,
					fromBase64Url(wrapped) as Uint8Array,
				),
			).toEqual(AK);
	});

	it("keeps the account key in the draft only: it is zero after wipe, and a wiped draft finishes nothing", async () => {
		const kept: Uint8Array[] = [];
		const base = scripted().prims;
		const prims: Primitives = {
			...base,
			aeadDecrypt: (...a) => {
				const out = base.aeadDecrypt(...a);
				kept.push(out);
				return out;
			},
		};
		const r = rig(prims);
		const draft = await beginRecovery(r.ports, { recoveryKeyText: RK.text });
		// The private key is gone with the step; the account key lives on, intact.
		const [accountKey, privateKey] = kept;
		expect(accountKey).toEqual(AK);
		expect(allZero([privateKey as Uint8Array])).toBe(true);
		draft.wipe();
		expect(allZero(kept)).toBe(true);
		await expect(
			finishRecovery(r.ports, draft, { password: NEW_PASSWORD }, OPTIONS),
		).rejects.toMatchObject({ code: "malformed" });
	});

	it("refuses a draft it did not make", async () => {
		const r = rig(scripted().prims);
		await expect(
			finishRecovery(
				r.ports,
				{ wipe: () => {} },
				{ password: NEW_PASSWORD },
				OPTIONS,
			),
		).rejects.toMatchObject({ code: "malformed" });
	});

	it("wipes the account key when the second wrap does not open", async () => {
		const kept: Uint8Array[] = [];
		const base = scripted().prims;
		const prims: Primitives = {
			...base,
			aeadDecrypt: (...a) => {
				const out = base.aeadDecrypt(...a);
				kept.push(out);
				return out;
			},
		};
		const a = goodAnswer();
		const r = rig(
			prims,
			setWrap(a, "private-key", flipped(wrapOf(a, "private-key"))),
		);
		await expect(
			beginRecovery(r.ports, { recoveryKeyText: RK.text }),
		).rejects.toMatchObject({ code: "malformed" });
		expect(kept.length).toBeGreaterThan(0);
		expect(allZero(kept)).toBe(true);
	});

	it("checks parameters before it derives, on its own", async () => {
		const r = rig(scripted().prims);
		const draft = await beginRecovery(r.ports, { recoveryKeyText: RK.text });
		await expect(
			finishRecovery(
				r.ports,
				draft,
				{ password: NEW_PASSWORD },
				{ params: { memoryKiB: 8, passes: 1 } },
			),
		).rejects.toMatchObject({ code: "params" });
		draft.wipe();
	});
});
