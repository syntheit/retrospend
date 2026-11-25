// The Make new key callbacks (src/client/new-key-flow.ts) over a scripted
// server that stores what it is sent: what is committed, the read-back by the
// wrap digest that follows, what an answer that never came may and may not
// cause to be sent again, and what a draft keeps and wipes. Each test spoils
// one thing the server does.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	fromBase64Url,
	fromHex,
	type Primitives,
	recoveryWrapDigest,
	SYMMETRIC_WRAP_BYTES,
	toBase64Url,
	wrapKey,
} from "../src";
import {
	couldNotAsk,
	createNewKeyCallbacks,
	isFinalRecoveryFailure,
	type KeyDraft,
	type KeyFlowCode,
	KeyFlowError,
	type NewKeyFlowPorts,
	recoveryFailureFor,
} from "../src/client";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
if (!MASTER) throw new Error("vector missing");
const PASSWORD = MASTER.password;
const WRAP_KEY = fromHex(MASTER.wrapKey);
const AUTH_KEY = toBase64Url(fromHex(MASTER.authKey));
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const AK = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);
const KDF = {
	salt: toBase64Url(fromHex(MASTER.salt)),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};

let p: Primitives;
let pair: { publicKey: Uint8Array; privateKey: Uint8Array };
beforeAll(async () => {
	p = await createWebPrimitives();
	pair = p.boxKeypair();
});

type Commit = { body: Record<string, unknown>; key: string };

/** A server holding the vector's account: one ak-recovery wrap it replaces on commit. */
function setup(
	over: {
		/** Runs instead of the store when a commit arrives; throw to refuse, return "lost" to store and lose the answer. */
		commit?: (n: number, store: () => void) => "lost" | undefined;
		/** Answers instead of the server's own (`normal`) answer. */
		open?: (
			n: number,
			body: { authKey: string },
			normal: () => unknown,
		) => unknown;
	} = {},
) {
	let version = 4;
	// A stand-in for the stored wrap (the right size, never opened here).
	let wrap: Uint8Array = new Uint8Array(SYMMETRIC_WRAP_BYTES).fill(7);
	const commits: Commit[] = [];
	const opens: { authKey: string }[] = [];
	let keyN = 0;
	const answer = () => ({
		version,
		kdf: KDF,
		publicKey: toBase64Url(pair.publicKey),
		wraps: [
			{
				role: "ak-password",
				targetId: USER_ID,
				wrapped: toBase64Url(wrapKey(p, WRAP_KEY, "ak-password", USER_ID, AK)),
			},
			{
				role: "private-key",
				targetId: USER_ID,
				wrapped: toBase64Url(
					wrapKey(p, AK, "private-key", USER_ID, pair.privateKey),
				),
			},
		],
		recoveryWrapDigest: toBase64Url(recoveryWrapDigest(p, wrap)),
	});
	const ports: NewKeyFlowPorts = {
		userId: USER_ID,
		primitives: async () => p,
		lookup: async () => ({ body: { kdf: KDF } }),
		lookupRoute: "keys",
		open: vi.fn(async (body: { authKey: string }) => {
			opens.push(body);
			const normal = () => {
				if (body.authKey !== AUTH_KEY) throw new KeyFlowError("wrongPassword");
				return answer();
			};
			if (over.open) return over.open(opens.length, body, normal);
			return normal();
		}),
		commit: vi.fn(async (body, key) => {
			commits.push({ body: { ...body }, key });
			const store = () => {
				wrap = fromBase64Url(body.wrappedRecoveryKey) as Uint8Array;
				version += 1;
			};
			let outcome: "lost" | undefined;
			if (over.commit) outcome = over.commit(commits.length, store);
			else store();
			if (outcome === "lost") throw new KeyFlowError("unavailable");
		}),
		newKey: () => `key-${++keyN}`,
	};
	return { ports, commits, opens, callbacks: createNewKeyCallbacks(ports) };
}

const codeOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

async function made(s: ReturnType<typeof setup>): Promise<KeyDraft> {
	return s.callbacks.makeKey(PASSWORD);
}

describe("a draft wiped while the read-back asks", () => {
	it("sends nothing: a wiped draft is not sent by a call that captured its body", async () => {
		let draft: KeyDraft | undefined;
		const s = setup({
			commit: (n) => (n === 1 ? "lost" : undefined),
			open: (n, _body, normal) => {
				// The first open makes the key; the second is the read-back before the retry.
				if (n === 2) draft?.wipe();
				return normal();
			},
		});
		draft = await made(s);
		expect(await codeOf(s.callbacks.save(draft))).toBe("unavailable");
		expect(await codeOf(s.callbacks.save(draft))).toBe("failed");
		expect(s.commits).toHaveLength(1);
	});
});

describe("createNewKeyCallbacks", () => {
	it("makes a key from the password and commits it, then reads it back by its digest", async () => {
		const s = setup();
		const draft = await made(s);
		expect(draft.keyText.split("-")).toHaveLength(9);
		await s.callbacks.save(draft);
		expect(s.commits).toHaveLength(1);
		const [commit] = s.commits;
		expect(commit?.body.currentAuthKey).toBe(AUTH_KEY);
		expect(commit?.body.baseVersion).toBe(4);
		// The password and the key text never go; only proofs and a wrap do.
		expect(JSON.stringify(commit?.body)).not.toContain(PASSWORD);
		expect(JSON.stringify(commit?.body)).not.toContain(draft.keyText);
		// One open to make the key, one to read it back.
		expect(s.opens).toHaveLength(2);
	});

	it("says a wrong password as wrongPassword and sends nothing", async () => {
		const s = setup();
		await expect(codeOf(s.callbacks.makeKey("not the password"))).resolves.toBe(
			"wrongPassword",
		);
		expect(s.commits).toHaveLength(0);
	});

	it("fails with notSaved when the server accepts the send and holds another wrap", async () => {
		const s = setup();
		// A server that accepts and stores nothing: the digest stays the old one.
		s.ports.commit = vi.fn(async () => {});
		const callbacks = createNewKeyCallbacks(s.ports);
		const draft = await callbacks.makeKey(PASSWORD);
		await expect(codeOf(callbacks.save(draft))).resolves.toBe("readBackFailed");
		expect(recoveryFailureFor("readBackFailed")).toBe("notSaved");
	});

	describe("a send whose answer never came", () => {
		it("is read back before anything is sent again, and a stored wrap is the success", async () => {
			const s = setup({
				commit: (_n, store) => {
					store();
					return "lost";
				},
			});
			const draft = await made(s);
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(
				"unavailable",
			);
			await s.callbacks.save(draft);
			// Stored the first time: no second commit.
			expect(s.commits).toHaveLength(1);
		});

		it("is sent again under a new key, with the same body, when the server holds nothing", async () => {
			const s = setup({
				commit: (n, store) => {
					if (n === 1) return "lost";
					store();
					return undefined;
				},
			});
			const draft = await made(s);
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(
				"unavailable",
			);
			await s.callbacks.save(draft);
			expect(s.commits).toHaveLength(2);
			expect(s.commits[1]?.key).not.toBe(s.commits[0]?.key);
			expect(s.commits[1]?.body).toEqual(s.commits[0]?.body);
		});

		it("is never sent again while the read-back itself cannot be made", async () => {
			let n = 0;
			const s = setup({
				commit: () => "lost",
				open: (_count, body) => {
					// The first open makes the key; the later ones fail to reach the server.
					if (++n === 1) {
						return {
							version: 4,
							kdf: KDF,
							publicKey: toBase64Url(pair.publicKey),
							wraps: [
								{
									role: "ak-password",
									targetId: USER_ID,
									wrapped: toBase64Url(
										wrapKey(p, WRAP_KEY, "ak-password", USER_ID, AK),
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
							recoveryWrapDigest: null,
						};
					}
					void body;
					throw new KeyFlowError("unavailable");
				},
			});
			const draft = await made(s);
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(
				"unavailable",
			);
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(
				"unavailable",
			);
			expect(s.commits).toHaveLength(1);
		});
	});

	describe("a read-back that cannot be asked", () => {
		/** A server that stores the commit and then refuses (or fails) every read-back after it. */
		function afterCommit(refusal: () => KeyFlowError) {
			let committed = false;
			const s = setup({
				commit: (_n, store) => {
					store();
					committed = true;
					return undefined;
				},
				open: (_n, _body, normal) => {
					if (committed) throw refusal();
					return normal();
				},
			});
			return s;
		}

		it.each([["wrongPassword"], ["sessionNotFresh"], ["failed"]] as const)(
			"a %s refusal after a stored commit is unconfirmed, never the final notSaved, and asking again settles it",
			async (code) => {
				let refuse = true;
				let committed = false;
				const s = setup({
					commit: (_n, store) => {
						store();
						committed = true;
						return undefined;
					},
					open: (_n, _body, normal) => {
						if (committed && refuse) throw new KeyFlowError(code);
						return normal();
					},
				});
				const draft = await made(s);
				await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(
					"unconfirmed",
				);
				expect(recoveryFailureFor("unconfirmed")).toBe("unconfirmed");
				expect(isFinalRecoveryFailure(recoveryFailureFor("unconfirmed"))).toBe(
					false,
				);
				// Asked again with an answer, the server holds our key: saved, and nothing was sent again.
				refuse = false;
				await s.callbacks.save(draft);
				expect(s.commits).toHaveLength(1);
			},
		);

		it("a server that answers with another digest is still the final notSaved", async () => {
			const s = setup();
			s.ports.commit = vi.fn(async () => {});
			const callbacks = createNewKeyCallbacks(s.ports);
			const draft = await callbacks.makeKey(PASSWORD);
			await expect(codeOf(callbacks.save(draft))).resolves.toBe(
				"readBackFailed",
			);
			expect(isFinalRecoveryFailure(recoveryFailureFor("readBackFailed"))).toBe(
				true,
			);
		});

		it("the codes the owner calls could-not-ask stay as they are and are not mismatches", async () => {
			for (const code of [
				"unavailable",
				"serverError",
				"rateLimited",
			] as const) {
				expect(couldNotAsk(code)).toBe(true);
				const s = afterCommit(() => new KeyFlowError(code));
				const draft = await made(s);
				await expect(codeOf(s.callbacks.save(draft))).resolves.toBe(code);
			}
		});
	});

	describe("a conflict", () => {
		it("is read back and not sent again: it is the success when the server holds our wrap", async () => {
			const s = setup({
				commit: (_n, store) => {
					store();
					throw new KeyFlowError("conflict");
				},
			});
			const draft = await made(s);
			await s.callbacks.save(draft);
			expect(s.commits).toHaveLength(1);
		});

		it("is keysChanged, and nothing is sent again, when the server holds another wrap", async () => {
			const s = setup({
				commit: () => {
					throw new KeyFlowError("conflict");
				},
			});
			const draft = await made(s);
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe("conflict");
			expect(recoveryFailureFor("conflict")).toBe("keysChanged");
			expect(s.commits).toHaveLength(1);
		});
	});

	describe("a draft", () => {
		it("sends nothing once wiped, and holds no secret after: the body is dropped", async () => {
			const s = setup();
			const draft = await made(s);
			draft.wipe();
			await expect(codeOf(s.callbacks.save(draft))).resolves.toBe("failed");
			expect(s.commits).toHaveLength(0);
		});

		it("is refused when another instance made it", async () => {
			const a = setup();
			const b = setup();
			const draft = await made(a);
			await expect(codeOf(b.callbacks.save(draft))).resolves.toBe("failed");
			expect(b.commits).toHaveLength(0);
		});
	});

	it("words every flow code, so a new code cannot go unmapped", () => {
		const codes: KeyFlowCode[] = [
			"typo",
			"wrongRecoveryKey",
			"recoveryUnavailable",
			"tokenExpired",
			"conflict",
			"rateLimited",
			"wrongPassword",
		];
		expect(codes.map(recoveryFailureFor)).toEqual([
			"typo",
			"wrongKey",
			"unavailable",
			"linkExpired",
			"keysChanged",
			"tooMany",
			"wrongPassword",
		]);
	});
});
