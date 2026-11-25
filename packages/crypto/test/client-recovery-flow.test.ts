// The recovery callbacks (src/client/recovery-flow.ts) over a scripted server
// that holds one reset link and the vector's account: the proof is checked
// before a new password is asked for, the commit spends the link, and an
// answer that never came is settled by asking whether the link is still live,
// never by sending the commit again blind.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_FLOOR,
	deriveMasterKey,
	fromBase64Url,
	fromHex,
	masterSubkeys,
	type Primitives,
	toBase64Url,
	toHex,
	wrapKey,
} from "../src";
import {
	createRecoveryCallbacks,
	type KeyFlowCode,
	KeyFlowError,
	mayHaveCommitted,
	type RecoverBody,
	type RecoveryFlowPorts,
	type RecoveryHandle,
} from "../src/client";
import { wrapKeyWithNonce } from "../src/keys";
import { signInSecret } from "../src/sign-in-secret";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
const RK = vectors.recoveryKeys[2];
const OTHER_RK = vectors.recoveryKeys[3];
if (!MASTER || !RK || !OTHER_RK) throw new Error("vector missing");
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const NEW_PASSWORD = MASTER.password;
const OPTIONS = { params: ARGON2_FLOOR };
const AK = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);

let p: Primitives;
let pair: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
	p = await createWebPrimitives();
	pair = p.boxKeypair();
});

/** A server holding the account: begin checks the proof, commit spends the link (or is scripted to fail). */
function setup(
	over: {
		/** n counts commits; return "lost" to spend the link and lose the answer, or throw to refuse. */
		commit?: (n: number, spend: () => void) => "lost" | undefined;
		check?: () => void;
		/** Runs where the core waits for the busy state to paint. */
		paint?: () => Promise<void>;
		/** Wraps the primitives, to make one of them misbehave. */
		prims?: (base: Primitives) => Primitives;
	} = {},
) {
	let live = true;
	const spend = () => {
		live = false;
	};
	const begins: { recoveryAuthKey: string }[] = [];
	const commits: RecoverBody[] = [];
	const wiped: Uint8Array[] = [];
	const counted: Primitives = {
		...p,
		argon2id: (...a) => {
			const out = p.argon2id(...a);
			wiped.push(out);
			return out;
		},
	};
	const prims = over.prims ? over.prims(counted) : counted;
	const ports: RecoveryFlowPorts = {
		primitives: async () => prims,
		paint: over.paint ?? (async () => {}),
		begin: vi.fn(async (body: { recoveryAuthKey: string }) => {
			begins.push(body);
			if (!live) throw new KeyFlowError("tokenExpired");
			if (
				toHex(fromBase64Url(body.recoveryAuthKey) as Uint8Array) !== RK?.authKey
			)
				throw new KeyFlowError("wrongRecoveryKey");
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
								Uint8Array.from({ length: 24 }, (_, i) => 0x41 + i),
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
			};
		}),
		check: vi.fn(async () => {
			over.check?.();
			if (!live) throw new KeyFlowError("tokenExpired");
		}),
		commit: vi.fn(async (body: RecoverBody) => {
			commits.push(body);
			if (!live) throw new KeyFlowError("tokenExpired");
			const outcome = over.commit?.(commits.length, spend);
			if (outcome === "lost") throw new KeyFlowError("unavailable");
			if (!over.commit) spend();
		}),
	};
	return {
		ports,
		begins,
		commits,
		argon: wiped,
		callbacks: createRecoveryCallbacks(ports, OPTIONS),
	};
}

const codeOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

describe("a sheet closed while the busy state paints", () => {
	const finishCode = async (s: ReturnType<typeof setup>, h: RecoveryHandle) =>
		codeOf(s.callbacks.finish(h, { password: NEW_PASSWORD }));

	it("wipes the handle during the wait and the run refuses: nothing is derived, wrapped or sent", async () => {
		let handle: RecoveryHandle | undefined;
		const s = setup({ paint: async () => handle?.wipe() });
		handle = await s.callbacks.begin(RK.text);
		// "failed" is the lost race. A wiped (all zero) account key that went on
		// would be refused as "malformed" by the key pair check, and that is a
		// different guard.
		await expect(finishCode(s, handle)).resolves.toBe("failed");
		expect(s.commits).toHaveLength(0);
		expect(s.argon).toHaveLength(0);
	});

	it("never wraps an account key that is not the account's, even if the handle was not wiped", async () => {
		// The key pair check opens the private key by sealing and opening a probe:
		// the first run (at begin) passes, the second (before wrapping) does not.
		let probes = 0;
		const s = setup({
			prims: (base) => ({
				...base,
				sealOpen: (...a) => {
					if (++probes === 2) throw new Error("not the account's key");
					return base.sealOpen(...a);
				},
			}),
		});
		const handle = await s.callbacks.begin(RK.text);
		await expect(finishCode(s, handle)).resolves.toBe("malformed");
		expect(s.commits).toHaveLength(0);
		expect(s.argon).toHaveLength(0);
	});
});

describe("createRecoveryCallbacks", () => {
	it("proves the key at begin, before any new password exists, then commits the body", async () => {
		const s = setup();
		const handle = await s.callbacks.begin(RK.text);
		expect(s.begins).toHaveLength(1);
		// No new password yet: no Argon2id run.
		expect(s.argon).toHaveLength(0);
		await s.callbacks.finish(handle, { password: NEW_PASSWORD });
		expect(s.commits).toHaveLength(1);
		const [body] = s.commits;
		expect(body?.recoveryAuthKey).toBe(toBase64Url(fromHex(RK.authKey)));
		// The new sign-in secret is the one the typed password makes under the body's own salt.
		const salt = fromBase64Url(body?.kdf.salt as string) as Uint8Array;
		expect(body?.newAuthKey).toBe(
			signInSecret(
				masterSubkeys(p, deriveMasterKey(p, NEW_PASSWORD, salt, ARGON2_FLOOR))
					.authKey,
			),
		);
		expect(body?.baseVersion).toBe(7);
		expect(JSON.stringify(body)).not.toContain(NEW_PASSWORD);
		expect(JSON.stringify(body)).not.toContain(RK.text);
	});

	it("stops a typo and a wrong key at begin, with no handle", async () => {
		const s = setup();
		await expect(codeOf(s.callbacks.begin("not a key"))).resolves.toBe("typo");
		expect(s.begins).toHaveLength(0);
		await expect(codeOf(s.callbacks.begin(OTHER_RK.text))).resolves.toBe(
			"wrongRecoveryKey",
		);
		expect(s.commits).toHaveLength(0);
	});

	it("sends nothing once its handle is wiped", async () => {
		const s = setup();
		const handle = await s.callbacks.begin(RK.text);
		handle.wipe();
		await expect(
			codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
		).resolves.toBe("failed");
		expect(s.commits).toHaveLength(0);
	});

	it("refuses a handle another instance made", async () => {
		const a = setup();
		const b = setup();
		const handle = await a.callbacks.begin(RK.text);
		await expect(
			codeOf(b.callbacks.finish(handle, { password: NEW_PASSWORD })),
		).resolves.toBe("failed");
		expect(b.commits).toHaveLength(0);
		handle.wipe();
	});

	describe("a commit whose answer never came", () => {
		it("is settled by the link check: a spent link is the success, and nothing is sent again", async () => {
			const s = setup({
				commit: (_n, spend) => {
					spend();
					return "lost";
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("unconfirmed");
			// A spent link is not "set": the caller cannot tell this commit from an
			// expired link, so it says so and the sign-in tells.
			await expect(
				s.callbacks.finish(handle, { password: NEW_PASSWORD }),
			).resolves.toBe("linkSpent");
			expect(s.ports.check).toHaveBeenCalledTimes(1);
			expect(s.commits).toHaveLength(1);
		});

		it("sends the same body again when the link is still live, without a second Argon2id run", async () => {
			const s = setup({
				commit: (n, spend) => {
					if (n === 1) return "lost";
					spend();
					return undefined;
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("unconfirmed");
			await expect(
				s.callbacks.finish(handle, { password: NEW_PASSWORD }),
			).resolves.toBe("set");
			expect(s.commits).toHaveLength(2);
			expect(s.commits[1]).toEqual(s.commits[0]);
			expect(s.argon).toHaveLength(1);
		});

		it("is never sent again while the check itself cannot be made", async () => {
			let calls = 0;
			const s = setup({
				commit: () => "lost",
				check: () => {
					calls += 1;
					throw new KeyFlowError("unavailable");
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD }));
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("unavailable");
			expect(calls).toBe(1);
			expect(s.commits).toHaveLength(1);
		});
	});

	describe("a refusal that makes the handle stale", () => {
		it.each([
			["conflict"],
			["wrongRecoveryKey"],
			["recoveryUnavailable"],
		] as const)("%s wipes it, and a retry sends nothing", async (code) => {
			const s = setup({
				commit: () => {
					throw new KeyFlowError(code);
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe(code);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("failed");
			expect(s.commits).toHaveLength(1);
		});

		it("a spent link at commit time is tokenExpired", async () => {
			const s = setup({
				commit: () => {
					throw new KeyFlowError("tokenExpired");
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("tokenExpired");
		});
	});

	describe("what a retry sends", () => {
		const OTHER_PASSWORD = "Another-Password-2027?";
		/** The sign-in secret a password makes under the salt a body carries. */
		const secretOf = (body: RecoverBody | undefined, password: string) =>
			signInSecret(
				masterSubkeys(
					p,
					deriveMasterKey(
						p,
						password,
						fromBase64Url(body?.kdf.salt as string) as Uint8Array,
						ARGON2_FLOOR,
					),
				).authKey,
			);

		it("a refused commit (a rate limit) makes the next body from the password typed then, not the first", async () => {
			const s = setup({
				commit: (n, spend) => {
					if (n === 1) throw new KeyFlowError("rateLimited");
					spend();
					return undefined;
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("rateLimited");
			await expect(
				s.callbacks.finish(handle, { password: OTHER_PASSWORD }),
			).resolves.toBe("set");
			expect(s.commits).toHaveLength(2);
			expect(s.commits[1]?.newAuthKey).toBe(
				secretOf(s.commits[1], OTHER_PASSWORD),
			);
			expect(s.commits[1]?.newAuthKey).not.toBe(
				secretOf(s.commits[0], NEW_PASSWORD),
			);
			// A body made again is a second Argon2id run.
			expect(s.argon).toHaveLength(2);
		});

		it("a commit whose outcome is not known is sent again as it was, whatever password the retry carries", async () => {
			const s = setup({
				commit: (n, spend) => {
					if (n === 1) return "lost";
					spend();
					return undefined;
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await expect(
				codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD })),
			).resolves.toBe("unconfirmed");
			await s.callbacks.finish(handle, { password: OTHER_PASSWORD });
			expect(s.commits).toHaveLength(2);
			expect(s.commits[1]).toEqual(s.commits[0]);
			expect(s.commits[1]?.newAuthKey).toBe(
				secretOf(s.commits[0], NEW_PASSWORD),
			);
			expect(s.argon).toHaveLength(1);
		});

		it("keeps the same body through a refusal that follows an unknown commit", async () => {
			const s = setup({
				commit: (n, spend) => {
					if (n === 1) return "lost";
					if (n === 2) throw new KeyFlowError("rateLimited");
					spend();
					return undefined;
				},
			});
			const handle = await s.callbacks.begin(RK.text);
			await codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD }));
			await codeOf(s.callbacks.finish(handle, { password: OTHER_PASSWORD }));
			await s.callbacks.finish(handle, { password: OTHER_PASSWORD });
			expect(s.commits).toHaveLength(3);
			expect(s.commits[2]).toEqual(s.commits[0]);
		});

		it("every code the owner says may have committed keeps the body, and no other does", async () => {
			const codes: KeyFlowCode[] = [
				"unavailable",
				"serverError",
				"rateLimited",
				"failed",
				"malformed",
			];
			for (const code of codes) {
				const s = setup({
					commit: (n, spend) => {
						if (n === 1) throw new KeyFlowError(code);
						spend();
						return undefined;
					},
				});
				const handle = await s.callbacks.begin(RK.text);
				await codeOf(s.callbacks.finish(handle, { password: NEW_PASSWORD }));
				await s.callbacks.finish(handle, { password: OTHER_PASSWORD });
				const same = mayHaveCommitted(code, 0);
				expect(
					s.commits[1]?.newAuthKey === s.commits[0]?.newAuthKey,
					code,
				).toBe(same);
			}
		});
	});
});
