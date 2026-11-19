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
	type EnablePorts,
	type EnableRequest,
	enableFailureFor,
	FAILURE_CODES,
	failureCode,
	isFinalFailure,
	type KeyDraft,
	KeyFlowError,
	type KeyFlowCode,
	createEnableCallbacks,
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
		spoil?: (answer: Answer, sent: EnableRequest, accountKey: Uint8Array) => void;
		enable?: EnablePorts["enable"];
		open?: EnablePorts["open"];
		signInAgain?: EnablePorts["signInAgain"];
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
			wraps: [
				wrap("ak-password"),
				wrap("private-key"),
				wrap("collection-key"),
			],
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
					if (!stored) throw new KeyFlowError("unavailable");
					const answer = honest(stored);
					over.spoil?.(answer, stored, accountKey());
					return JSON.parse(JSON.stringify(answer));
				}),
		),
		signInAgain: vi.fn(over.signInAgain ?? (async () => {})),
		record: { has: vi.fn(async () => false), set: vi.fn(async () => {}) },
		newKey: (() => {
			let n = 0;
			return () => `key-${++n}`;
		})(),
	} satisfies EnablePorts;
	const callbacks = createEnableCallbacks(ports, OPTIONS);
	return { ports, callbacks, sent, wiped, accountKey };
}

const INPUT = { password: "old password 1", code: null };
const failsWith = async (run: Promise<unknown>, code: string) => {
	const error = await run.then(
		() => null,
		(e: unknown) => e,
	);
	expect(failureCode(error)).toBe(code);
};

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
		await again.callbacks.save(d2, { password: "old password 1", code: "123456" });
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

	it("keeps one Idempotency-Key for a draft across retries, and a new one for the next draft", async () => {
		let refuse = true;
		const s = setup({
			enable: async (body, key) => {
				s.sent.push({ body, key });
				if (refuse) throw new KeyFlowError("unavailable");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		refuse = false;
		await expect(s.callbacks.save(draft, INPUT)).rejects.toMatchObject({
			code: "checkFailed",
		});
		const other = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(other, INPUT).catch(() => undefined);
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

	it("does not fail the save when the record cannot be written", async () => {
		const s = setup();
		s.ports.record.set.mockRejectedValue(new Error("storage"));
		const draft = await s.callbacks.makeKeys("new password 1A");
		await expect(s.callbacks.save(draft, INPUT)).resolves.toBeUndefined();
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

	it.each(spoiled)("is a final error when the server answers %s", async (_n, spoil) => {
		const s = setup({ spoil });
		const draft = await s.callbacks.makeKeys("new password 1A");
		const error = await s.callbacks.save(draft, INPUT).then(
			() => null,
			(e: unknown) => e,
		);
		expect(failureCode(error)).toBe("checkFailed");
		expect(isFinalFailure(failureCode(error))).toBe(true);
	});

	it("is a final error when keys/open fails or answers nothing readable", async () => {
		for (const open of [
			async () => {
				throw new KeyFlowError("rateLimited");
			},
			async () => null,
			async () => "text",
		]) {
			const s = setup({ open });
			const draft = await s.callbacks.makeKeys("new password 1A");
			await failsWith(s.callbacks.save(draft, INPUT), "checkFailed");
		}
	});
});

describe("an old session", () => {
	it("signs in again with what was typed and sends the same request again", async () => {
		let calls = 0;
		const s = setup({
			enable: async (body, key) => {
				s.sent.push({ body, key });
				if (++calls === 1) throw new KeyFlowError("sessionNotFresh");
			},
		});
		const input = { password: "old password 1", code: "123456" };
		const draft = await s.callbacks.makeKeys("new password 1A");
		await s.callbacks.save(draft, input).catch(() => undefined);
		expect(s.ports.signInAgain).toHaveBeenCalledWith(input);
		expect(s.sent.map((x) => x.key)).toEqual(["key-1", "key-1"]);
		expect(s.sent[1]?.body).toEqual(s.sent[0]?.body);
	});

	it("gives up after one sign-in, and passes on why signing in failed", async () => {
		const s = setup({
			enable: async () => {
				throw new KeyFlowError("sessionNotFresh");
			},
		});
		const draft = await s.callbacks.makeKeys("new password 1A");
		await failsWith(s.callbacks.save(draft, INPUT), "failed");
		expect(s.ports.signInAgain).toHaveBeenCalledTimes(1);
		expect(s.ports.enable).toHaveBeenCalledTimes(2);

		const wrong = setup({
			enable: async () => {
				throw new KeyFlowError("sessionNotFresh");
			},
			signInAgain: async () => {
				throw new KeyFlowError("wrongPassword");
			},
		});
		const d2 = await wrong.callbacks.makeKeys("new password 1A");
		await failsWith(wrong.callbacks.save(d2, INPUT), "wrongPassword");
		expect(wrong.ports.enable).toHaveBeenCalledTimes(1);
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
