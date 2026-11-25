// Getting back in on the phone: what the typed API client is called with (the
// code, the token, the recovery proof, the commit body), the words each
// refusal gets, and that no secret is sent where it should not be. The flow
// itself (proof before a new password, checks before sending, settling a lost
// commit) is packages/crypto/test/client-recovery-flow.test.ts; this file runs
// it through the phone's ports with the cheapest allowed Argon2id parameters.
// Jest cannot load the native module, so react-native-libsodium is
// libsodium.js (same API); the native Argon2id needs a run on a phone.
import {
	ARGON2_FLOOR,
	fromBase64Url,
	fromHex,
	type Primitives,
	toBase64Url,
	toHex,
	wrapKey,
} from "@retrospend/crypto";
import { type KeyFlowCode, KeyFlowError } from "@retrospend/crypto/client";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { loadWebSodium } from "@retrospend/crypto/web";

// The contract's runtime is ESM, so the real password rules file (it imports
// nothing) stands in for it.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/data/ids", () => ({ newClientId: () => "client-id" }));

type Recovery = typeof import("./recovery");
let h: Recovery;
let real: Primitives;

jest.setTimeout(120_000);

beforeAll(async () => {
	const sodium = await loadWebSodium();
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	h = require("./recovery") as Recovery;
	real = await require("@/crypto/native").getPrimitives();
});

const RK = vectors.recoveryKeys[2];
if (!RK) throw new Error("vector missing");
const USER = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const TOKEN = "recovery-token-1";
const AK = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);
const NEW = "A brand new passphrase 7";
const ANOTHER = "Another new passphrase 8";

const refusal = (status: number, code?: string) =>
	Object.assign(new Error("x"), { status, code });

type Commit = {
	token: string;
	recoveryAuthKey: string;
	newAuthKey: string;
	wrappedAccountKey: string;
	baseVersion: number;
};

/** A server holding one account with one live recovery token. */
function server(
	script: {
		/** n counts commits: lose its answer after spending the token, refuse it, or let it through. */
		commit?: (n: number, spend: () => void) => "lost" | "refuse" | undefined;
	} = {},
) {
	let live = true;
	const spend = () => {
		live = false;
	};
	const pair = real.boxKeypair();
	const commits: Commit[] = [];
	const begin = jest.fn(
		async (body: { token: string; recoveryAuthKey: string }) => {
			if (!live || body.token !== TOKEN) throw refusal(404, "invalid_token");
			if (toHex(fromBase64Url(body.recoveryAuthKey) as Uint8Array) !== RK?.authKey)
				throw refusal(400, "wrong_recovery_key");
			return {
				userId: USER,
				version: 7,
				publicKey: toBase64Url(pair.publicKey),
				wraps: [
					{
						role: "ak-recovery",
						targetId: USER,
						wrapped: toBase64Url(
							wrapKey(real, fromHex(RK?.wrapKey ?? ""), "ak-recovery", USER, AK),
						),
					},
					{
						role: "private-key",
						targetId: USER,
						wrapped: toBase64Url(
							wrapKey(real, AK, "private-key", USER, pair.privateKey),
						),
					},
				],
			};
		},
	);
	const checkRecovery = jest.fn(async (body: { token: string }) => {
		if (!live || body.token !== TOKEN) throw refusal(404, "invalid_token");
		return { keys: "recovery", protectionOn: true };
	});
	const recover = jest.fn(async (body: Commit) => {
		commits.push(body);
		if (!live) throw refusal(404, "invalid_token");
		const outcome = script.commit?.(commits.length, spend);
		if (outcome === "refuse") throw refusal(429, "rate_limited");
		if (outcome === "lost") throw new TypeError("connection lost");
		spend();
		return { version: 8, signedOut: 0 };
	});
	const api = { begin, checkRecovery, recover } as const;
	const made = h.phoneRecoveryCallbacks(
		{
			beginRecovery: begin,
			checkRecovery,
			recover,
			requestResetCode: jest.fn(),
			redeemResetCode: jest.fn(),
		} as never,
		TOKEN,
		{ primitives: async () => real, paint: async () => {} },
		ARGON2_FLOOR,
	);
	return { made, commits, ...api };
}

const codeOf = async (run: Promise<unknown>): Promise<string> =>
	run.then(
		() => "none",
		(e: unknown) => (e instanceof KeyFlowError ? e.code : "other"),
	);

describe("phone recovery", () => {
	it("proves the key with the token before a new password exists, then commits once without any secret text", async () => {
		const s = server();
		const handle = await s.made.begin(RK.text);
		expect(s.begin).toHaveBeenCalledTimes(1);
		expect(s.begin.mock.calls[0]?.[0]).toEqual({
			token: TOKEN,
			recoveryAuthKey: toBase64Url(fromHex(RK.authKey)),
		});
		expect(s.recover).not.toHaveBeenCalled();
		expect(await s.made.finish(handle, { password: NEW })).toBe("set");
		expect(s.commits).toHaveLength(1);
		const [sent] = s.commits;
		expect(sent?.token).toBe(TOKEN);
		expect(sent?.baseVersion).toBe(7);
		const wire = JSON.stringify(s.commits);
		expect(wire).not.toContain(NEW);
		expect(wire).not.toContain(RK.text);
		expect(wire).not.toContain(RK.recoveryKey);
	});

	it("refuses a key with a typo before anything is sent, and a wrong key at the server", async () => {
		const s = server();
		expect(await codeOf(s.made.begin("not a key"))).toBe("typo");
		expect(s.begin).not.toHaveBeenCalled();
		expect(
			await codeOf(s.made.begin(vectors.recoveryKeys[3]?.text ?? "")),
		).toBe("wrongRecoveryKey");
		expect(s.recover).not.toHaveBeenCalled();
	});

	it("after a commit whose answer never came, asks whether the link is spent and then does not send again", async () => {
		const s = server({
			commit: (_n, spend) => {
				spend();
				return "lost";
			},
		});
		const handle = await s.made.begin(RK.text);
		expect(await codeOf(s.made.finish(handle, { password: NEW }))).toBe(
			"unconfirmed",
		);
		expect(await s.made.finish(handle, { password: NEW })).toBe("linkSpent");
		expect(s.checkRecovery).toHaveBeenCalledWith({ token: TOKEN });
		expect(s.recover).toHaveBeenCalledTimes(1);
	});

	it("after a lost answer with the link still live, sends the very same request again", async () => {
		const s = server({ commit: (n) => (n === 1 ? "lost" : undefined) });
		const handle = await s.made.begin(RK.text);
		expect(await codeOf(s.made.finish(handle, { password: NEW }))).toBe(
			"unconfirmed",
		);
		// The retry carries a different typed password; the request that may have committed goes again as it was.
		expect(await s.made.finish(handle, { password: ANOTHER })).toBe("set");
		expect(s.commits).toHaveLength(2);
		expect(s.commits[1]).toEqual(s.commits[0]);
	});

	it("after a refused commit, makes the next one from the password typed then", async () => {
		const s = server({ commit: (n) => (n === 1 ? "refuse" : undefined) });
		const handle = await s.made.begin(RK.text);
		expect(await codeOf(s.made.finish(handle, { password: NEW }))).toBe(
			"rateLimited",
		);
		expect(await s.made.finish(handle, { password: ANOTHER })).toBe("set");
		expect(s.commits).toHaveLength(2);
		expect(s.commits[1]?.newAuthKey).not.toBe(s.commits[0]?.newAuthKey);
	});

	it("sends nothing once the handle is wiped", async () => {
		const s = server();
		const handle = await s.made.begin(RK.text);
		handle.wipe();
		expect(await codeOf(s.made.finish(handle, { password: NEW }))).toBe(
			"failed",
		);
		expect(s.recover).not.toHaveBeenCalled();
	});
});

describe("asking for and swapping the reset code", () => {
	const api = (over: Record<string, unknown> = {}) =>
		({
			requestResetCode: jest.fn(async () => ({ success: true })),
			redeemResetCode: jest.fn(async () => ({ token: "t" })),
			checkRecovery: jest.fn(),
			...over,
		}) as never as Parameters<Recovery["requestResetCode"]>[0] &
			Parameters<Recovery["redeemResetCode"]>[0] &
			Parameters<Recovery["checkRecoveryLink"]>[0];

	it("asks with the address as typed less its edges, and says nothing about the account", async () => {
		const a = api();
		const first = await h.requestResetCode(a, "  ana@example.com ");
		expect(a.requestResetCode).toHaveBeenCalledWith({ email: "ana@example.com" });
		expect(first).toEqual({ ok: true, value: null });
	});

	it.each([
		[429, "tooMany"],
		[409, "cannotSend"],
		[500, "failed"],
		[400, "failed"],
	] as const)("a %i answer to the request is %s", async (status, reason) => {
		const a = api({
			requestResetCode: jest.fn(async () => {
				throw refusal(status);
			}),
		});
		expect(await h.requestResetCode(a, "ana@example.com")).toEqual({
			ok: false,
			reason,
		});
	});

	it("no answer to the request is network", async () => {
		const a = api({
			requestResetCode: jest.fn(async () => {
				throw new TypeError("offline");
			}),
		});
		expect(await h.requestResetCode(a, "ana@example.com")).toEqual({
			ok: false,
			reason: "network",
		});
	});

	it("reads the typed code the way the recovery key is read, and sends its normal form", async () => {
		const a = api();
		const swapped = await h.redeemResetCode(a, "ana@example.com", " 7k2m-9pq4 ");
		expect(a.redeemResetCode).toHaveBeenCalledWith({
			email: "ana@example.com",
			code: "7K2M9PQ4",
		});
		expect(swapped).toEqual({ ok: true, value: "t" });
		// O, I and L are read as 0 and 1.
		await h.redeemResetCode(a, "ana@example.com", "oilO 7K2M");
		expect(
			(a.redeemResetCode as jest.Mock).mock.calls[1]?.[0],
		).toEqual({ email: "ana@example.com", code: "01107K2M" });
	});

	it("refuses text that cannot be a code without asking, so no try is spent", async () => {
		const a = api();
		for (const text of ["", "7K2M9PQ", "7K2M9PQ4X", "7K2M9PQU", "7K2M9PQé"])
			expect(await h.redeemResetCode(a, "ana@example.com", text)).toEqual({
				ok: false,
				reason: "typo",
			});
		expect(a.redeemResetCode).not.toHaveBeenCalled();
	});

	it.each([
		[404, "invalid_token", "wrongCode"],
		[429, "rate_limited", "tooMany"],
		[500, undefined, "failed"],
	] as const)("a %i answer to the swap is %s", async (status, code, reason) => {
		const a = api({
			redeemResetCode: jest.fn(async () => {
				throw refusal(status, code);
			}),
		});
		expect(await h.redeemResetCode(a, "ana@example.com", "7K2M9PQ4")).toEqual({
			ok: false,
			reason,
		});
	});

	it("an answer without a token is a failure, never a token", async () => {
		for (const answer of [{}, { token: "" }, { token: 4 }, null]) {
			const a = api({ redeemResetCode: jest.fn(async () => answer) });
			expect(await h.redeemResetCode(a, "ana@example.com", "7K2M9PQ4")).toEqual({
				ok: false,
				reason: "failed",
			});
		}
	});
});

describe("checking what the token leads to", () => {
	const answers = (answer: () => Promise<unknown>) =>
		({ checkRecovery: jest.fn(answer) }) as never as Parameters<
			Recovery["checkRecoveryLink"]
		>[0];

	it("returns what the server says, read by the shared reader", async () => {
		const a = answers(async () => ({ keys: "recovery", protectionOn: false }));
		await expect(h.checkRecoveryLink(a, "t")).resolves.toEqual({
			keys: "recovery",
			protectionOn: false,
		});
		expect(a.checkRecovery).toHaveBeenCalledWith({ token: "t" });
	});

	it("a token the server does not know is invalid, not an error", async () => {
		const a = answers(async () => {
			throw refusal(404, "invalid_token");
		});
		await expect(h.checkRecoveryLink(a, "t")).resolves.toBe("invalid");
	});

	it("an answer of another shape, or no answer, throws and is never read as no keys", async () => {
		const odd = answers(async () => ({ keys: "yes", protectionOn: true }));
		await expect(h.checkRecoveryLink(odd, "t")).rejects.toMatchObject({
			code: "unavailable" satisfies KeyFlowCode,
		});
		const offline = answers(async () => {
			throw new TypeError("offline");
		});
		await expect(h.checkRecoveryLink(offline, "t")).rejects.toMatchObject({
			code: "unavailable" satisfies KeyFlowCode,
		});
	});
});
