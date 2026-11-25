// The enable sheet's callbacks over a scripted server (src/client/enable-flow.ts):
// what is sent, the read-back that follows and its digest check, signing in
// again for an old session, the words each failure gets, and what a draft keeps
// and wipes. The server here answers what it stored, so each test spoils one
// thing in the answer.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	ARGON2_FLOOR,
	fromBase64Url,
	type Primitives,
	recoveryWrapDigest,
	toBase64Url,
	wrapKey,
} from "../src";
import {
	createEnableCallbacks,
	createEnableLifecycle,
	type EnablePorts,
	type EnableRequest,
	type EnableSignInStep,
	enableFailureFor,
	FAILURE_CODES,
	failureCode,
	isFinalFailure,
	type KeyDraft,
	type KeyFlowCode,
	KeyFlowError,
} from "../src/client";
import { createWebPrimitives } from "../src/web";

const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const OPTIONS = { params: ARGON2_FLOOR };

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

type Answer = Record<string, unknown>;

/** A scripted server: stores what enable was sent and answers keys/open from it. */
function setup(
	over: {
		spoil?: (
			answer: Answer,
			sent: EnableRequest,
			accountKey: Uint8Array,
		) => void;
		enable?: EnablePorts["enable"];
		open?: EnablePorts["open"];
		signIn?: EnablePorts["signIn"];
		verifyCode?: EnablePorts["verifyCode"];
	} = {},
) {
	const wiped: Uint8Array[] = [];
	const randoms: Uint8Array[] = [];
	const prims: Primitives = {
		...p,
		randomBytes: (n) => {
			const out = p.randomBytes(n);
			randoms.push(out);
			return out;
		},
		wipe: (b) => {
			wiped.push(b);
			p.wipe(b);
		},
	};
	/** The account key: the first 32 random bytes the flow asked for. */
	const accountKey = () => randoms.find((r) => r.length === 32) as Uint8Array;
	let stored: EnableRequest | null = null;
	const sent: { body: EnableRequest; key: string }[] = [];
	const honest = (body: EnableRequest): Answer => {
		const wrap = (role: string) => {
			const w = body.wraps.find((x) => x.role === role);
			return { id: crypto.randomUUID(), ...w };
		};
		const recovery = fromBase64Url(
			body.wraps.find((w) => w.role === "ak-recovery")?.wrapped ?? "",
		) as Uint8Array;
		return {
			version: 1,
			createdAt: "2026-11-19T10:00:00.000Z",
			kdf: { ...body.kdf },
			publicKey: body.publicKey,
			wraps: [wrap("ak-password"), wrap("private-key"), wrap("collection-key")],
			recoveryWrapDigest: toBase64Url(recoveryWrapDigest(p, recovery)),
		};
	};
	const ports = {
		primitives: async () => prims,
		paint: vi.fn(async () => {}),
		userId: USER_ID,
		enable: vi.fn(
			over.enable ??
				(async (body: EnableRequest, key: string) => {
					stored = body;
					sent.push({ body, key });
				}),
		),
		open: vi.fn(
			over.open ??
				(async () => {
					if (!stored) throw new KeyFlowError("notFound");
					const answer = honest(stored);
					over.spoil?.(answer, stored, accountKey());
					return JSON.parse(JSON.stringify(answer));
				}),
		),
		signIn: vi.fn(
			over.signIn ?? (async () => ({ status: "signedIn" }) as EnableSignInStep),
		),
		verifyCode: vi.fn(
			over.verifyCode ??
				(async () => ({ status: "signedIn" }) as EnableSignInStep),
		),
		record: { has: vi.fn(async () => false), set: vi.fn(async () => {}) },
		newKey: (() => {
			let n = 0;
			return () => `key-${++n}`;
		})(),
	} satisfies EnablePorts;
	const callbacks = createEnableCallbacks(ports, OPTIONS);
	/** The server commits a request (as a send that then loses its answer does). */
	const commit = (body: EnableRequest, key: string) => {
		stored = body;
		sent.push({ body, key });
	};
	return { ports, callbacks, sent, wiped, accountKey, commit };
}

const INPUT = { password: "old password 1", code: null };
const failsWith = async (run: Promise<unknown>, code: string) => {
	const error = await run.then(
		() => null,
		(e: unknown) => e,
	);
	expect(failureCode(error)).toBe(code);
};

describe("a draft wiped while the keyed record is read", () => {
	it("sends nothing: the sheet that made it is gone", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		s.ports.record.has.mockImplementationOnce(async () => {
			draft.wipe();
			return false;
		});
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).not.toHaveBeenCalled();
	});
});

describe("makeKeys", () => {
	it("makes keys once, shows the key text and sends nothing", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		expect(draft.keyText.length).toBeGreaterThan(40);
		expect(s.ports.enable).not.toHaveBeenCalled();
		expect(s.ports.open).not.toHaveBeenCalled();
		expect(s.ports.paint).toHaveBeenCalledTimes(1);
	});

	it("rejects with an EnableFailure and holds no keys when the parameters are refused", async () => {
		const s = setup();
		const bad = createEnableCallbacks(s.ports, {
			params: { memoryKiB: 1024, passes: 1 },
		});
		await failsWith(bad.makeKeys("new password 1A"), "failed");
	});

	it("wipes only its own draft's keys: another draft still saves and reads back", async () => {
		const s = setup();
		const a = await s.callbacks.makeKeys("new password 1A");
		const b = await s.callbacks.makeKeys("new password 1A");
		a.wipe();
		await failsWith(s.callbacks.save(a, INPUT), "failed");
		await s.callbacks.save(b, INPUT);
	});
});

describe("save", () => {
	it("sends the body with the typed password, and the code only when there is one", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, { password: "old password 1", code: null });
		const first = s.sent[0]?.body as EnableRequest;
		expect(first.currentPassword).toBe("old password 1");
		expect("totpCode" in first).toBe(false);
		expect(first.wraps).toHaveLength(4);
		const again = setup();
		const d2 = await again.callbacks.makeKeys("new password 1A");
		await again.callbacks.save(d2, {
			password: "old password 1",
			code: "123456",
		});
		expect(again.sent[0]?.body.totpCode).toBe("123456");
	});

	it("never sends the new password or the recovery key text", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, INPUT);
		const wire = JSON.stringify(s.sent[0]?.body);
		expect(wire).not.toContain("new password 1A");
		expect(wire).not.toContain(draft.keyText);
	});

	it("sends each attempt under its own Idempotency-Key, and a new key for the next draft", async () => {
		let refuse = true;
		const s = setup({
			enable: async (body, key) => {
				if (refuse) {
					s.sent.push({ body, key });
					throw new KeyFlowError("wrongPassword");
				}
				s.commit(body, key);
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "wrongPassword");
		refuse = false;
		await s.callbacks.save(draft, INPUT);
		const other = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(other, INPUT);
		// A refusal stored nothing, so the draft's second try is the same send; the next draft is its own.
		expect(s.sent.map((x) => x.key)).toEqual(["key-1", "key-1", "key-2"]);
	});

	it("reads the keys back with the new sign-in secret and says nothing when they match", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, INPUT);
		expect(s.ports.open).toHaveBeenCalledWith({
			authKey: s.sent[0]?.body.authKey,
		});
	});

	it("records the account as keyed once the server has the keys, even if the read-back then fails", async () => {
		const s = setup({ spoil: (a) => (a.recoveryWrapDigest = null) });
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
		expect(s.ports.record.set).toHaveBeenCalledTimes(1);
		const refused = setup({
			enable: async () => {
				throw new KeyFlowError("wrongPassword");
			},
		});
		const d2 = await refused.callbacks.makeKeys("new password 1A");
		await failsWith(refused.callbacks.save(d2, INPUT), "wrongPassword");
		expect(refused.ports.record.set).not.toHaveBeenCalled();
	});

	it("is final when this device cannot save that the account is keyed, and the keys are not sent again", async () => {
		const s = setup();
		s.ports.record.set.mockRejectedValue(new Error("storage"));
		const draft = await s.callbacks.makeKeys("new password 1A");
		const error = await s.callbacks.save(draft, INPUT).then(
			() => null,
			(e: unknown) => e,
		);
		expect(failureCode(error)).toBe("deviceRecordNotSaved");
		expect(isFinalFailure(failureCode(error))).toBe(true);
		await s.callbacks.save(draft, INPUT).catch(() => undefined);
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
	});

	it("does not wipe the draft: the sheet does, when it closes", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, INPUT);
		expect(s.accountKey().some((x) => x !== 0)).toBe(true);
		draft.wipe();
		expect(s.accountKey().every((x) => x === 0)).toBe(true);
	});

	it("refuses a draft it did not make and one that was wiped, before sending anything", async () => {
		const s = setup();
		const stranger: KeyDraft = { keyText: "x", wipe: () => {} };
		await failsWith(s.callbacks.save(stranger, INPUT), "failed");
		const draft = await s.callbacks.makeKeys("new password 1A");
		draft.wipe();
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).not.toHaveBeenCalled();
	});
});

describe("read-back", () => {
	const wrapItem = (a: Answer, role: string) =>
		(a.wraps as Answer[]).find((x) => x.role === role) as Answer;
	const spoiled: [
		string,
		(a: Answer, sent: EnableRequest, accountKey: Uint8Array) => void,
	][] = [
		[
			"another ak-recovery digest",
			(a) => {
				const d = fromBase64Url(a.recoveryWrapDigest as string) as Uint8Array;
				d[0] = (d[0] ?? 0) ^ 1;
				a.recoveryWrapDigest = toBase64Url(d);
			},
		],
		["no digest", (a) => (a.recoveryWrapDigest = null)],
		["a digest of the wrong length", (a) => (a.recoveryWrapDigest = "AAAA")],
		["other kdf parameters", (a) => ((a.kdf as Answer).passes = 9)],
		[
			"another salt",
			(a) => ((a.kdf as Answer).salt = toBase64Url(new Uint8Array(16))),
		],
		[
			"another public key",
			(a) => (a.publicKey = toBase64Url(new Uint8Array(32))),
		],
		["no wraps", (a) => (a.wraps = [])],
		[
			"a duplicated wrap",
			(a) => (a.wraps as unknown[]).push((a.wraps as unknown[])[0]),
		],
		[
			"a private key wrap that opens to another key",
			(a, _sent, ak) => {
				wrapItem(a, "private-key").wrapped = toBase64Url(
					wrapKey(p, ak, "private-key", USER_ID, p.randomBytes(32)),
				);
			},
		],
		[
			"a collection key wrap bound to another key id",
			(a, _sent, ak) => {
				wrapItem(a, "collection-key").wrapped = toBase64Url(
					wrapKey(p, ak, "collection-key", "ff".repeat(16), p.randomBytes(32)),
				);
			},
		],
		...(["ak-password", "private-key", "collection-key"] as const).flatMap(
			(role): [string, (a: Answer) => void][] => [
				[
					`a changed ${role} wrap`,
					(a) => {
						const w = wrapItem(a, role);
						const bytes = fromBase64Url(w.wrapped as string) as Uint8Array;
						bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
						w.wrapped = toBase64Url(bytes);
					},
				],
				[
					`no ${role} wrap`,
					(a) => {
						a.wraps = (a.wraps as Answer[]).filter((x) => x.role !== role);
					},
				],
			],
		),
	];

	it.each(spoiled)(
		"is a final error when the server answers %s",
		async (_n, spoil) => {
			const s = setup({ spoil });
			const draft = await s.callbacks.makeKeys("new password 1A");
			const error = await s.callbacks.save(draft, INPUT).then(
				() => null,
				(e: unknown) => e,
			);
			expect(failureCode(error)).toBe("checkFailed");
			expect(isFinalFailure(failureCode(error))).toBe(true);
		},
	);

	it("is a final error when keys/open answers something that is not a key set", async () => {
		for (const open of [async () => null, async () => "text"]) {
			const s = setup({ open });
			const draft = await s.callbacks.makeKeys("new password 1A");
			await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
		}
	});

	it("is final when keys/open refuses the new sign-in secret or says the keys changed", async () => {
		for (const code of [
			"wrongPassword",
			"conflict",
			"notOffered",
			"failed",
		] as const) {
			const s = setup({
				open: async () => {
					throw new KeyFlowError(code);
				},
			});
			const draft = await s.callbacks.makeKeys("new password 1A");
			await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
		}
	});

	it("is not final when the read-back never got an answer: saving again reads back and sends nothing", async () => {
		let reached = false;
		const s = setup();
		const open = s.ports.open.getMockImplementation() as EnablePorts["open"];
		s.ports.open.mockImplementation(async (body) => {
			if (!reached) throw new KeyFlowError("unavailable");
			return open(body);
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		const first = await s.callbacks.save(draft, INPUT).then(
			() => null,
			(e: unknown) => e,
		);
		expect(failureCode(first)).toBe("failed");
		expect(isFinalFailure(failureCode(first))).toBe(false);
		s.ports.open.mockImplementationOnce(async () => {
			throw new KeyFlowError("rateLimited");
		});
		await failsWith(s.callbacks.save(draft, INPUT), "tooMany");
		reached = true;
		await s.callbacks.save(draft, INPUT);
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
		expect(s.ports.open).toHaveBeenCalledTimes(3);
		// The record was written once, on the first pass.
		expect(s.ports.record.set).toHaveBeenCalledTimes(1);
	});

	it("is final when the keys are gone from a server that accepted them", async () => {
		const s = setup({
			open: async () => {
				throw new KeyFlowError("notFound");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
	});
});

describe("a send whose answer was lost", () => {
	const twice = async () => {
		let n = 0;
		const s = setup({
			enable: async (body, key) => {
				// The first send commits and then the answer is lost.
				if (n++ === 0) {
					s.commit(body, key);
					throw new KeyFlowError("unavailable");
				}
				s.commit(body, key);
			},
		});
		return s;
	};

	it("A: saving again reads the committed keys back and is done, without sending again", async () => {
		const s = await twice();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await s.callbacks.save(draft, INPUT);
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
		expect(s.ports.record.set).toHaveBeenCalledTimes(1);
	});

	it("B: a retyped code after a lost answer is never sent under the key of the first body", async () => {
		const s = await twice();
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(
			s.callbacks.save(draft, { password: "old password 1", code: "111111" }),
			"failed",
		);
		await s.callbacks.save(draft, {
			password: "old password 1",
			code: "222222",
		});
		expect(s.sent).toHaveLength(1);
		expect(s.sent[0]?.body.totpCode).toBe("111111");
	});

	it("C: a server failure after the commit (a gateway 502) is read back, so a retyped code is never sent under the used key", async () => {
		let n = 0;
		const s = setup({
			enable: async (body, key) => {
				s.commit(body, key);
				if (n++ === 0) throw new KeyFlowError("serverError");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(
			s.callbacks.save(draft, { password: "old password 1", code: "111111" }),
			"failed",
		);
		await s.callbacks.save(draft, {
			password: "old password 1",
			code: "222222",
		});
		expect(s.sent).toHaveLength(1);
		expect(s.ports.record.set).toHaveBeenCalledTimes(1);
	});

	it("reads a reused key back only when an earlier send of the draft may have committed", async () => {
		const first = setup({
			enable: async () => {
				throw new KeyFlowError("keyReused");
			},
		});
		const d1 = await first.callbacks.makeKeys("new password 1A");
		await failsWith(first.callbacks.save(d1, INPUT), "failed");
		await failsWith(first.callbacks.save(d1, INPUT), "failed");
		expect(first.ports.enable).toHaveBeenCalledTimes(2);
		expect(first.ports.open).not.toHaveBeenCalled();

		let n = 0;
		const later = setup({
			enable: async (body, key) => {
				// Never delivered, then committed under a second key whose answer says the key was used.
				if (n++ === 0) throw new KeyFlowError("unavailable");
				later.commit(body, key);
				throw new KeyFlowError("keyReused");
			},
		});
		const d2 = await later.callbacks.makeKeys("new password 1A");
		await failsWith(later.callbacks.save(d2, INPUT), "failed");
		await failsWith(later.callbacks.save(d2, INPUT), "failed");
		await later.callbacks.save(d2, INPUT);
		expect(later.ports.enable).toHaveBeenCalledTimes(2);
	});

	it("sends again under a new key when the read-back finds no keys", async () => {
		let n = 0;
		const s = setup({
			enable: async (body, key) => {
				if (n++ === 0) {
					// Never delivered: nothing was stored.
					s.sent.push({ body, key });
					throw new KeyFlowError("unavailable");
				}
				s.commit(body, key);
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await s.callbacks.save(draft, {
			password: "old password 1",
			code: "222222",
		});
		expect(s.sent.map((x) => x.key)).toEqual(["key-1", "key-2"]);
		expect(s.sent[1]?.body.totpCode).toBe("222222");
	});

	it("keeps asking, and sends nothing, when the read-back meets a server failure too", async () => {
		const s = setup({
			enable: async () => {
				throw new KeyFlowError("serverError");
			},
			open: async () => {
				throw new KeyFlowError("serverError");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
	});

	it("keeps asking, and sends nothing, while the read-back cannot be made", async () => {
		const s = setup({
			enable: async () => {
				throw new KeyFlowError("unavailable");
			},
			open: async () => {
				throw new KeyFlowError("unavailable");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
		expect(s.ports.open).toHaveBeenCalledTimes(2);
	});

	it("is final when keys are there but are not the ones sent", async () => {
		let n = 0;
		const s = setup({
			enable: async () => {
				if (n++ === 0) throw new KeyFlowError("unavailable");
			},
			open: async () => {
				// Some other set of keys answers to this sign-in secret.
				throw new KeyFlowError("wrongPassword");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
	});

	it("reads a conflict back only when an earlier send of the draft may have committed", async () => {
		const first = setup({
			enable: async () => {
				throw new KeyFlowError("conflict");
			},
		});
		const d1 = await first.callbacks.makeKeys("new password 1A");
		await failsWith(first.callbacks.save(d1, INPUT), "failed");
		await failsWith(first.callbacks.save(d1, INPUT), "failed");
		// A conflict on a first send stored nothing of ours: the next try sends again.
		expect(first.ports.enable).toHaveBeenCalledTimes(2);
		expect(first.ports.open).not.toHaveBeenCalled();

		let n = 0;
		const later = setup({
			enable: async (body, key) => {
				if (n++ === 0) throw new KeyFlowError("unavailable");
				later.commit(body, key);
				throw new KeyFlowError("conflict");
			},
		});
		const d2 = await later.callbacks.makeKeys("new password 1A");
		await failsWith(later.callbacks.save(d2, INPUT), "failed");
		await failsWith(later.callbacks.save(d2, INPUT), "failed");
		// The conflict after an earlier send: the next save reads back (keys match) and is done.
		await later.callbacks.save(d2, INPUT);
		expect(later.ports.enable).toHaveBeenCalledTimes(2);
	});
});

describe("a device that knows the account is keyed", () => {
	it("sends nothing when it holds the keyed record", async () => {
		const s = setup();
		s.ports.record.has.mockResolvedValue(true);
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).not.toHaveBeenCalled();
		expect(s.ports.signIn).not.toHaveBeenCalled();
	});

	it("sends nothing when the record cannot be read (fails closed)", async () => {
		const s = setup();
		s.ports.record.has.mockRejectedValue(new Error("storage"));
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).not.toHaveBeenCalled();
	});

	it("looks at the record before every send, including the one after a lost answer", async () => {
		const s = setup({
			enable: async () => {
				throw new KeyFlowError("unavailable");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.record.has).toHaveBeenCalledTimes(1);
		s.ports.record.has.mockResolvedValue(true);
		s.ports.open.mockRejectedValue(new KeyFlowError("notFound"));
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
	});
});

describe("an old session", () => {
	const stale =
		(s: () => ReturnType<typeof setup>, n = { v: 0 }): EnablePorts["enable"] =>
		async (body, key) => {
			if (n.v++ === 0) throw new KeyFlowError("sessionNotFresh");
			s().commit(body, key);
		};
	const error = (kind: "rejected" | "rateLimited" | "unreachable" | "other") =>
		({ status: "error", kind }) as EnableSignInStep;
	let current: ReturnType<typeof setup>;
	/** A server whose first send finds the session too old. */
	const withStale = (over: Parameters<typeof setup>[0]) => {
		current = setup({ enable: stale(() => current), ...over });
		return current;
	};

	it("signs in again with what was typed and sends the same request again", async () => {
		const s = withStale({});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, { password: "old password 1", code: null });
		expect(s.ports.signIn).toHaveBeenCalledWith("old password 1");
		expect(s.ports.verifyCode).not.toHaveBeenCalled();
		expect(s.ports.enable).toHaveBeenCalledTimes(2);
		const [a, b] = s.ports.enable.mock.calls;
		expect(b).toEqual(a);
	});

	it("asks for the code next when the account has two-factor", async () => {
		const s = withStale({
			signIn: async () => ({ status: "twoFactor" }),
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, {
			password: "old password 1",
			code: "123456",
		});
		expect(s.ports.verifyCode).toHaveBeenCalledWith("123456");
	});

	it("reads a missing code as a wrong one, and sends nothing more", async () => {
		const s = withStale({
			signIn: async () => ({ status: "twoFactor" }),
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "wrongCode");
		expect(s.ports.verifyCode).not.toHaveBeenCalled();
		expect(s.ports.enable).toHaveBeenCalledTimes(1);
	});

	it.each([
		["a rejected password", error("rejected"), undefined, "wrongPassword"],
		["a rate limit", error("rateLimited"), undefined, "tooMany"],
		["no answer", error("unreachable"), undefined, "failed"],
		["anything else", error("other"), undefined, "failed"],
		[
			"a rejected code",
			{ status: "twoFactor" } as EnableSignInStep,
			error("rejected"),
			"wrongCode",
		],
		[
			"a code step that asks for a code again",
			{ status: "twoFactor" } as EnableSignInStep,
			{ status: "twoFactor" } as EnableSignInStep,
			"failed",
		],
	])(
		"words %s while signing in again as %s and does not send twice",
		async (_n, first, then, expected) => {
			const s = withStale({
				signIn: async () => first,
				verifyCode: async () => then ?? { status: "signedIn" },
			});
			const draft = await s.callbacks.makeKeys("new password 1A");
			await failsWith(
				s.callbacks.save(draft, { password: "old password 1", code: "123456" }),
				expected,
			);
			expect(s.ports.enable).toHaveBeenCalledTimes(1);
			expect(s.ports.open).not.toHaveBeenCalled();
		},
	);

	it("gives up after one sign-in when the session is still too old", async () => {
		const s = setup({
			enable: async () => {
				throw new KeyFlowError("sessionNotFresh");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.signIn).toHaveBeenCalledTimes(1);
		expect(s.ports.enable).toHaveBeenCalledTimes(2);
	});
});

describe("the words a failure gets", () => {
	const table: [KeyFlowCode, string][] = [
		["wrongPassword", "wrongPassword"],
		["wrongCode", "wrongCode"],
		["rateLimited", "tooMany"],
		["notOffered", "notOffered"],
		["readBackFailed", "checkFailed"],
		["unavailable", "failed"],
		["conflict", "failed"],
		["failed", "failed"],
		["malformed", "failed"],
		["notFound", "failed"],
		["serverError", "failed"],
		["keyReused", "failed"],
		["unreadable", "deviceRecordNotSaved"],
	];
	it.each(table)("%s reads as %s", async (code, expected) => {
		expect(enableFailureFor(code)).toBe(expected);
		const s = setup({
			enable: async () => {
				throw new KeyFlowError(code);
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), expected);
	});

	it("reads anything that is not a flow error as failed, and every code has a line", async () => {
		const s = setup({
			enable: async () => {
				throw new TypeError("boom");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		for (const [, line] of table) expect(FAILURE_CODES).toContain(line);
	});
});

describe("the draft's keys through the sheet's lifecycle", () => {
	// The sheet's own controller drives the callbacks, as it does on screen:
	// the account key stays until the sheet leaves, and every exit wipes it.
	const sheet = () => {
		const s = setup({
			spoil: (a) => (a.recoveryWrapDigest = null),
		});
		const life = createEnableLifecycle({ reset: () => {} });
		return { s, life };
	};
	const made = async (
		s: ReturnType<typeof setup>,
		life: ReturnType<typeof sheet>["life"],
	) => {
		const out = await life.makeDraft(() =>
			s.callbacks.makeKeys("new password 1A"),
		);
		if (out.status !== "done") throw new Error("no draft");
		return out.value;
	};
	const alive = (s: ReturnType<typeof setup>) =>
		s.accountKey().some((x) => x !== 0);

	it("keeps the keys after a saved draft until the sheet closes, then wipes them", async () => {
		const s = setup();
		const life = createEnableLifecycle({ reset: () => {} });
		const draft = await made(s, life);
		await life.run(() => s.callbacks.save(draft, INPUT));
		expect(alive(s)).toBe(true);
		life.closed();
		expect(alive(s)).toBe(false);
	});

	it("wipes them when the save failed for good and the sheet then closes", async () => {
		const { s, life } = sheet();
		const draft = await made(s, life);
		const out = await life.run(() => s.callbacks.save(draft, INPUT));
		expect(out.status).toBe("failed");
		expect(alive(s)).toBe(true);
		life.closed();
		expect(alive(s)).toBe(false);
	});

	it("wipes them when the sheet unmounts, and when the person goes back to the password", async () => {
		const gone = setup();
		const life = createEnableLifecycle({ reset: () => {} });
		await made(gone, life);
		life.unmounted();
		expect(alive(gone)).toBe(false);

		const back = setup();
		const life2 = createEnableLifecycle({ reset: () => {} });
		await made(back, life2);
		life2.back("methods");
		expect(alive(back)).toBe(false);
	});
});
