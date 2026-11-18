// The shared password change for a keyed account (src/client/rotate.ts)
// against a fake server behind the ports, with the F3 key vectors: the old
// password, salt and parameters are the second master vector (floor
// parameters, known answers from a generator that shares no code with the
// package); the account key and the wrap's id and nonce are the ak-password
// wrap vector's, sealed under the vector's own wrap key the way enable would
// have stored it. Cheaper parameters than the default are injected where the
// run does not depend on them.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_DEFAULT,
	ARGON2_FLOOR,
	deriveMasterKey,
	fromBase64Url,
	fromHex,
	masterSubkeys,
	type Primitives,
	signInSecret,
	toBase64Url,
	unwrapKey,
} from "../src";
import {
	type CommitBody,
	classifyRefusal,
	type Kdf,
	KeyFlowError,
	NEW_PASSWORD_PARAMS,
	type RotatePorts,
	rotatePassword,
} from "../src/client";
import { wrapKeyWithNonce } from "../src/keys";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
const WRAP = vectors.symmetricWraps.find((w) => w.role === "ak-password");
if (!MASTER || !WRAP) throw new Error("vector missing");
const USER_ID = WRAP.id;
const AK = fromHex(WRAP.key);
const OLD_KDF: Kdf = {
	salt: toBase64Url(fromHex(MASTER.salt)),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};
const OLD_AUTH_KEY = toBase64Url(fromHex(MASTER.authKey));
const OLD_PASSWORD = MASTER.password;
const NEXT = "A brand new passphrase 7";
const CHEAP = { newParams: ARGON2_FLOOR };

let p: Primitives;
let oldWrap: string;
beforeAll(async () => {
	p = await createWebPrimitives();
	oldWrap = toBase64Url(
		wrapKeyWithNonce(
			p,
			fromHex(MASTER.wrapKey),
			"ak-password",
			USER_ID,
			AK,
			fromHex(WRAP.nonce),
		),
	);
});

type Server = {
	keys?: () => Kdf | null;
	/** The keys route is missing for this account (404). */
	noKeys?: boolean;
	begin?: (n: number, body: { currentAuthKey: string }) => unknown;
	commit?: (n: number) => void;
};

/** The ports of a fake server holding the vector's account. */
function rig(server: Server = {}, primitives?: Primitives) {
	const begins: { currentAuthKey: string }[] = [];
	const commits: { body: CommitBody; key: string }[] = [];
	const paint = vi.fn(async () => {});
	const prims = vi.fn(async () => primitives ?? p);
	const set = vi.fn(async () => {});
	const ports: RotatePorts = {
		primitives: prims,
		paint,
		lookup: async () =>
			server.noKeys
				? { missing: true as const }
				: { body: { kdf: server.keys ? server.keys() : OLD_KDF } },
		lookupRoute: "keys",
		record: { has: async () => false, set },
		begin: async (body) => {
			const n = begins.push(body) - 1;
			if (server.begin) return server.begin(n, body);
			if (body.currentAuthKey !== OLD_AUTH_KEY)
				throw new KeyFlowError("wrongPassword");
			return { version: 3, kdf: OLD_KDF, wrappedAccountKey: oldWrap };
		},
		commit: async (body, key) => {
			const n = commits.push({ body, key }) - 1;
			server.commit?.(n);
		},
		newKey: (() => {
			let n = 0;
			return () => `key-${++n}`;
		})(),
	};
	const run = (
		current = OLD_PASSWORD,
		next = NEXT,
		options: Parameters<typeof rotatePassword>[2] = CHEAP,
	) => rotatePassword(ports, { userId: USER_ID, current, next }, options);
	return { ports, begins, commits, paint, prims, set, run };
}

const codeOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

/** What a password opens from the values a commit carried. */
function open(sent: CommitBody, password: string) {
	const salt = fromBase64Url(sent.kdf.salt) as Uint8Array;
	const master = deriveMasterKey(p, password, salt, sent.kdf);
	const { authKey, wrapKey } = masterSubkeys(p, master);
	return {
		authKey: signInSecret(authKey),
		accountKey: () =>
			unwrapKey(
				p,
				wrapKey,
				"ak-password",
				USER_ID,
				fromBase64Url(sent.wrappedAccountKey) as Uint8Array,
			),
	};
}

describe("rotatePassword", () => {
	it("proves the vector's old password, then sends a wrap the new password opens to the same account key", async () => {
		const t = rig();
		await t.run();
		expect(t.begins).toEqual([{ currentAuthKey: OLD_AUTH_KEY }]);
		expect(t.commits).toHaveLength(1);
		const sent = t.commits[0]?.body as CommitBody;
		expect(sent.currentAuthKey).toBe(OLD_AUTH_KEY);
		expect(sent.baseVersion).toBe(3);
		expect(sent.kdf.salt).not.toBe(OLD_KDF.salt);
		expect(fromBase64Url(sent.kdf.salt)).toHaveLength(16);
		const now = open(sent, NEXT);
		expect(sent.newAuthKey).toBe(now.authKey);
		expect(sent.newAuthKey).not.toBe(sent.currentAuthKey);
		expect(now.accountKey()).toEqual(AK);
		// The old password no longer opens the new wrap.
		expect(() => open(sent, MASTER.password).accountKey()).toThrow();
		// Neither typed password goes anywhere, only what was derived.
		const wire = JSON.stringify([t.begins, t.commits]);
		expect(wire).not.toContain(NEXT);
		expect(wire).not.toContain(MASTER.password);
		// Recorded as keyed afterwards.
		expect(t.set).toHaveBeenCalledTimes(1);
	});

	it("makes the new key set with the default Argon2id parameters unless a test says otherwise", async () => {
		expect(NEW_PASSWORD_PARAMS).toEqual(ARGON2_DEFAULT);
		const t = rig();
		await t.run(MASTER.password, NEXT, {});
		const sent = t.commits[0]?.body as CommitBody;
		expect(sent.kdf.memoryKiB).toBe(ARGON2_DEFAULT.memoryKiB);
		expect(sent.kdf.passes).toBe(ARGON2_DEFAULT.passes);
		expect(open(sent, NEXT).accountKey()).toEqual(AK);
	}, 60_000);

	it("refuses injected parameters outside the floor, before any derivation", async () => {
		const t = rig();
		expect(
			await codeOf(
				t.run(MASTER.password, NEXT, {
					newParams: { memoryKiB: 1024, passes: 1 },
				}),
			),
		).toBe("params");
		expect(t.paint).not.toHaveBeenCalled();
		expect(t.begins).toHaveLength(0);
	});

	it("a wrong old password stops at begin and sends no commit", async () => {
		const t = rig();
		expect(await codeOf(t.run("not the password"))).toBe("wrongPassword");
		expect(t.begins).toHaveLength(1);
		expect(t.commits).toHaveLength(0);
		expect(t.set).not.toHaveBeenCalled();
	});

	describe("before sending", () => {
		it("refuses a new wrap that does not open", async () => {
			// The only seal in the run is the new wrap: one flipped byte in it.
			const t = rig(
				{},
				{
					...p,
					aeadEncrypt: (...args) => {
						const out = p.aeadEncrypt(...args);
						out[0] = (out[0] ?? 0) ^ 1;
						return out;
					},
				},
			);
			expect(await codeOf(t.run())).toBe("malformed");
			expect(t.commits).toHaveLength(0);
		});

		it("refuses a new wrap that opens to a different account key", async () => {
			const t = rig(
				{},
				{
					...p,
					aeadEncrypt: (key, nonce, _plain, aad) =>
						p.aeadEncrypt(key, nonce, p.randomBytes(32), aad),
				},
			);
			expect(await codeOf(t.run())).toBe("malformed");
			expect(t.commits).toHaveLength(0);
		});

		it("refuses a new auth key that the new password does not make again", async () => {
			// kdfDerive runs old auth, old wrap, new auth, new wrap, check auth,
			// check wrap: damage the third, so the sent key differs from the
			// re-derived one.
			let n = 0;
			const t = rig(
				{},
				{
					...p,
					kdfDerive: (...args) => {
						const out = p.kdfDerive(...args);
						if (++n === 3) out[0] = (out[0] ?? 0) ^ 1;
						return out;
					},
				},
			);
			expect(await codeOf(t.run())).toBe("malformed");
			expect(n).toBeGreaterThanOrEqual(6);
			expect(t.commits).toHaveLength(0);
		});

		it("refuses a begin wrap that does not open under the old password", async () => {
			const bad = fromBase64Url(oldWrap) as Uint8Array;
			bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
			const t = rig({
				begin: () => ({
					version: 3,
					kdf: OLD_KDF,
					wrappedAccountKey: toBase64Url(bad),
				}),
			});
			expect(await codeOf(t.run())).toBe("malformed");
			expect(t.commits).toHaveLength(0);
		});

		it("is unavailable, with no commit, when the begin answer is not the expected shape", async () => {
			const good = { version: 3, kdf: OLD_KDF, wrappedAccountKey: oldWrap };
			for (const body of [
				null,
				"begin",
				{},
				{ version: 1 },
				{ ...good, version: undefined },
				{ ...good, version: 3.5 },
				{ ...good, version: "3" },
				{ ...good, kdf: null },
				{ ...good, kdf: { ...OLD_KDF, passes: 1.5 } },
				{ ...good, wrappedAccountKey: undefined },
				{ ...good, wrappedAccountKey: 7 },
			]) {
				const t = rig({ begin: () => body });
				expect(await codeOf(t.run())).toBe("unavailable");
				expect(t.commits).toHaveLength(0);
			}
		});

		it("is unavailable, not a downgrade, when the keys route answers a null kdf", async () => {
			const t = rig({ keys: () => null });
			expect(await codeOf(t.run())).toBe("unavailable");
			expect(t.begins).toHaveLength(0);
		});

		it("refuses a begin wrap that is not base64url", async () => {
			const t = rig({
				begin: () => ({ version: 3, kdf: OLD_KDF, wrappedAccountKey: "***" }),
			});
			expect(await codeOf(t.run())).toBe("malformed");
			expect(t.commits).toHaveLength(0);
		});
	});

	describe("a key set that changed between the keys route and begin", () => {
		const other = [
			{ ...OLD_KDF, salt: toBase64Url(new Uint8Array(16).fill(9)) },
			{ ...OLD_KDF, memoryKiB: OLD_KDF.memoryKiB + 1024 },
			{ ...OLD_KDF, passes: OLD_KDF.passes + 1 },
		];

		it("is a conflict, run once more, and sends no commit", async () => {
			for (const kdf of other) {
				const t = rig({
					begin: () => ({ version: 3, kdf, wrappedAccountKey: oldWrap }),
				});
				expect(await codeOf(t.run())).toBe("conflict");
				expect(t.begins).toHaveLength(2);
				expect(t.commits).toHaveLength(0);
			}
		});

		it("succeeds when the second run finds the key set stable", async () => {
			const t = rig({
				begin: (n) => ({
					version: 3,
					kdf: n === 0 ? (other[0] as Kdf) : OLD_KDF,
					wrappedAccountKey: oldWrap,
				}),
			});
			await t.run();
			expect(t.begins).toHaveLength(2);
			expect(t.commits).toHaveLength(1);
		});
	});

	describe("a conflict at the commit", () => {
		it("starts over once with a new Idempotency-Key and its own salt", async () => {
			const t = rig({
				commit: (n) => {
					if (n === 0) throw new KeyFlowError("conflict");
				},
			});
			await t.run();
			expect(t.begins).toHaveLength(2);
			expect(t.commits).toHaveLength(2);
			expect(t.commits.map((c) => c.key)).toEqual(["key-1", "key-2"]);
			expect(t.commits[0]?.body.kdf.salt).not.toBe(t.commits[1]?.body.kdf.salt);
		});

		it("is the answer after a second one, with no third run", async () => {
			const t = rig({
				commit: () => {
					throw new KeyFlowError("conflict");
				},
			});
			expect(await codeOf(t.run())).toBe("conflict");
			expect(t.begins).toHaveLength(2);
			expect(t.commits).toHaveLength(2);
			expect(t.set).not.toHaveBeenCalled();
		});

		it("is the only failure that is run again", async () => {
			for (const code of [
				"wrongPassword",
				"rateLimited",
				"notOffered",
				"unavailable",
				"failed",
			] as const) {
				const t = rig({
					commit: () => {
						throw new KeyFlowError(code);
					},
				});
				expect(await codeOf(t.run())).toBe(code);
				expect(t.commits).toHaveLength(1);
			}
		});
	});

	it("refuses an account the keys route says has no keys, before any derivation", async () => {
		const t = rig({ noKeys: true });
		expect(await codeOf(t.run())).toBe("downgrade");
		expect(t.paint).not.toHaveBeenCalled();
		expect(t.prims).not.toHaveBeenCalled();
		expect(t.begins).toHaveLength(0);
	});

	it("refuses parameters or a salt the keys route sent that are not allowed, before any derivation", async () => {
		for (const [kdf, code] of [
			[{ ...OLD_KDF, memoryKiB: 1024 }, "params"],
			[{ ...OLD_KDF, salt: "AAAA" }, "malformed"],
		] as const) {
			const t = rig({ keys: () => kdf });
			expect(await codeOf(t.run())).toBe(code);
			expect(t.paint).not.toHaveBeenCalled();
			expect(t.prims).not.toHaveBeenCalled();
			expect(t.begins).toHaveLength(0);
		}
	});

	it("is still done when the keyed record cannot be written", async () => {
		const t = rig();
		t.ports.record.set = async () => {
			throw new Error("keystore");
		};
		await t.run();
		expect(t.commits).toHaveLength(1);
	});

	describe("wiping", () => {
		const watch = () => {
			const kept: Uint8Array[] = [];
			const track = (bytes: Uint8Array) => {
				kept.push(bytes);
				return bytes;
			};
			const q: Primitives = {
				...p,
				argon2id: (...a) => track(p.argon2id(...a)),
				kdfDerive: (...a) => track(p.kdfDerive(...a)),
				aeadDecrypt: (...a) => track(p.aeadDecrypt(...a)),
			};
			return { kept, q };
		};
		const allZero = (kept: Uint8Array[]) =>
			kept.every((b) => b.every((x) => x === 0));

		it("wipes every key it derived or opened after a change", async () => {
			const w = watch();
			await rig({}, w.q).run();
			// Three derivations (old, new, check), six subkeys, the opened account
			// key twice.
			expect(w.kept).toHaveLength(3 + 6 + 2);
			expect(w.kept.every((b) => b.length === 32)).toBe(true);
			expect(allZero(w.kept)).toBe(true);
		});

		it("wipes them when the server refuses the commit", async () => {
			const w = watch();
			const t = rig(
				{
					commit: () => {
						throw new KeyFlowError("wrongPassword");
					},
				},
				w.q,
			);
			await codeOf(t.run());
			expect(w.kept.length).toBeGreaterThan(0);
			expect(allZero(w.kept)).toBe(true);
		});

		it("wipes them when the proof is refused", async () => {
			const w = watch();
			await codeOf(rig({}, w.q).run("not the password"));
			expect(w.kept).toHaveLength(3);
			expect(allZero(w.kept)).toBe(true);
		});
	});
});

describe("classifyRefusal", () => {
	it("maps a refusal by its status, and a wrong password only as the 400 with its code", () => {
		expect(classifyRefusal(null, undefined)).toBe("unavailable");
		expect(classifyRefusal(429, undefined)).toBe("rateLimited");
		expect(classifyRefusal(400, "wrong_password")).toBe("wrongPassword");
		expect(classifyRefusal(409, "conflict")).toBe("conflict");
		expect(classifyRefusal(501, "not_implemented")).toBe("notOffered");
		expect(classifyRefusal(400, "wrong_recovery_key")).toBe("wrongRecoveryKey");
		expect(classifyRefusal(404, "invalid_token")).toBe("tokenExpired");
		expect(classifyRefusal(409, "recovery_unavailable")).toBe(
			"recoveryUnavailable",
		);
		expect(classifyRefusal(500, undefined)).toBe("failed");
		// A code without its status is not enough, and a status without its code
		// is not a wrong password.
		expect(classifyRefusal(500, "wrong_password")).toBe("failed");
		expect(classifyRefusal(200, "conflict")).toBe("failed");
		expect(classifyRefusal(400, "validation")).toBe("failed");
		expect(classifyRefusal(500, "wrong_recovery_key")).toBe("failed");
		expect(classifyRefusal(400, "invalid_token")).toBe("failed");
		expect(classifyRefusal(404, "wrong_recovery_key")).toBe("failed");
	});
});
