import {
	ARGON2_FLOOR,
	deriveMasterKey,
	encodeRecoveryKey,
	fromBase64Url,
	masterSubkeys,
	type Primitives,
	recoverySubkeys,
	signInSecret,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { KeyFlowError, recoveryFailureOf } from "@retrospend/crypto/client";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkRecoveryLink, webRecoveryCallbacks } from "./recovery";

// The web's side of recovery: the routes and bodies it sends, the token it
// holds, what a refusal becomes and how a lost commit is settled. The flow
// itself (proof before password, the checks before sending, the wiping) is
// packages/crypto/test/client-recovery-flow.test.ts; this file runs it through
// the web ports with a scripted server and cheaper parameters than the real ones.
const TOKEN = "reset-token-0123";
const USER_ID = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const CHECK = "/api/v1/auth/recovery/check";
const BEGIN = "/api/v1/auth/recovery/begin";
const COMMIT = "/api/v1/auth/recovery";
const PASSWORD = "Correct-horse-9-battery";

let p: Primitives;
let keyText: string;
let otherKeyText: string;
let proof: string;
let wraps: { role: string; targetId: string; wrapped: string }[];
let publicKey: string;
beforeAll(async () => {
	p = await createWebPrimitives();
	const recovery = p.randomBytes(32);
	keyText = encodeRecoveryKey(recovery);
	otherKeyText = encodeRecoveryKey(p.randomBytes(32));
	const subkeys = recoverySubkeys(p, recovery);
	proof = toBase64Url(subkeys.authKey);
	const accountKey = p.randomBytes(32);
	const pair = p.boxKeypair();
	publicKey = toBase64Url(pair.publicKey);
	wraps = [
		{
			role: "ak-recovery",
			targetId: USER_ID,
			wrapped: toBase64Url(
				wrapKey(p, subkeys.wrapKey, "ak-recovery", USER_ID, accountKey),
			),
		},
		{
			role: "private-key",
			targetId: USER_ID,
			wrapped: toBase64Url(
				wrapKey(p, accountKey, "private-key", USER_ID, pair.privateKey),
			),
		},
	];
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const problem = (code: string, status: number) =>
	json({ code, status }, status);

type Sent = Record<string, unknown>;
type Script = {
	check?: () => Response | null;
	/** A commit that stores and loses its answer, or one that is refused. */
	commit?: (n: number) => "lost" | "lostLive" | Response | null;
};

function setup(script: Script = {}) {
	const calls: { url: string; init: RequestInit | undefined; body: Sent }[] =
		[];
	let live = true;
	let commits = 0;
	const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const path = String(url);
		const body = JSON.parse(String(init?.body)) as Sent;
		calls.push({ url: path, init, body });
		if (body.token !== TOKEN || !live) return problem("invalid_token", 404);
		if (path === CHECK)
			return script.check?.() ?? json({ keys: "recovery", protectionOn: true });
		if (path === BEGIN) {
			if (body.recoveryAuthKey !== proof)
				return problem("wrong_recovery_key", 400);
			return json({ userId: USER_ID, version: 3, publicKey, wraps });
		}
		if (path === COMMIT) {
			const outcome = script.commit?.(commits++) ?? null;
			if (outcome instanceof Response) return outcome;
			// "lostLive": the request never arrived, so the link is still good.
			if (outcome === "lostLive") throw new TypeError("connection lost");
			live = false;
			if (outcome === "lost") throw new TypeError("connection lost");
			return json({ version: 4, signedOut: 2 });
		}
		return problem("not_found", 404);
	});
	const deps = {
		fetch: fetch as typeof globalThis.fetch,
		storage: null,
		paint: async () => {},
		primitives: async () => p,
	};
	const callbacks = webRecoveryCallbacks(TOKEN, {
		deps,
		params: ARGON2_FLOOR,
	});
	const to = (path: string) => calls.filter((c) => c.url === path);
	return { callbacks, calls, to, deps };
}

const codeOf = async (run: Promise<unknown>) => {
	try {
		await run;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

describe("checkRecoveryLink", () => {
	it("sends the token to the check route and reads the answer by hand", async () => {
		const s = setup();
		await expect(checkRecoveryLink(TOKEN, { deps: s.deps })).resolves.toEqual({
			keys: "recovery",
			protectionOn: true,
		});
		expect(s.calls).toHaveLength(1);
		expect(s.calls[0]?.url).toBe(CHECK);
		expect(s.calls[0]?.body).toEqual({ token: TOKEN });
		expect(s.calls[0]?.init?.method).toBe("POST");
	});

	it("says invalid for a link the server does not know, and nothing else for it", async () => {
		const s = setup();
		await expect(checkRecoveryLink("nope", { deps: s.deps })).resolves.toBe(
			"invalid",
		);
	});

	it("is never read as no keys when the question is not answered", async () => {
		for (const [res, code] of [
			[problem("rate_limited", 429), "rateLimited"],
			[problem("internal", 500), "serverError"],
			[json({ keys: "everything", protectionOn: true }), "unavailable"],
			[json({ keys: "none" }), "unavailable"],
			[json(null), "unavailable"],
		] as const) {
			const s = setup({ check: () => res });
			await expect(
				codeOf(checkRecoveryLink(TOKEN, { deps: s.deps })),
			).resolves.toBe(code);
		}
		const down = vi.fn(async () => {
			throw new TypeError("offline");
		});
		await expect(
			codeOf(
				checkRecoveryLink(TOKEN, {
					deps: { ...setup().deps, fetch: down as unknown as typeof fetch },
				}),
			),
		).resolves.toBe("unavailable");
	});
});

describe("web recovery", () => {
	it("proves the key at begin and sends the token with the proof, never the key text", async () => {
		const s = setup();
		const handle = await s.callbacks.begin(keyText);
		const [begin] = s.to(BEGIN);
		expect(begin?.body).toEqual({ token: TOKEN, recoveryAuthKey: proof });
		expect(JSON.stringify(s.calls)).not.toContain(keyText);
		handle.wipe();
	});

	it("never sends a typo", async () => {
		const s = setup();
		await expect(codeOf(s.callbacks.begin("not a key"))).resolves.toBe("typo");
		expect(s.calls).toHaveLength(0);
	});

	it("says a key of another account as the wrong key (400)", async () => {
		const s = setup();
		const code = await codeOf(s.callbacks.begin(otherKeyText));
		expect(code).toBe("wrongRecoveryKey");
		expect(recoveryFailureOf(new KeyFlowError(code as "typo"))).toBe(
			"wrongKey",
		);
	});

	it("commits with the token and no Idempotency-Key, and the body holds no password", async () => {
		const s = setup();
		const handle = await s.callbacks.begin(keyText);
		await s.callbacks.finish(handle, { password: PASSWORD });
		const [commit] = s.to(COMMIT);
		expect(commit?.body.token).toBe(TOKEN);
		expect(Object.keys(commit?.body ?? {}).sort()).toEqual([
			"baseVersion",
			"kdf",
			"newAuthKey",
			"recoveryAuthKey",
			"token",
			"wrappedAccountKey",
		]);
		const headers = commit?.init?.headers as Record<string, string>;
		expect(headers["idempotency-key"]).toBeUndefined();
		expect(headers["content-type"]).toBe("application/json");
		expect(commit?.init?.credentials).toBe("same-origin");
		expect(JSON.stringify(commit?.body)).not.toContain(PASSWORD);
		// The sign-in secret is what the typed password makes under the sent kdf.
		const kdf = commit?.body.kdf as {
			salt: string;
			memoryKiB: number;
			passes: number;
		};
		const salt = fromBase64Url(kdf.salt) as Uint8Array;
		expect(commit?.body.newAuthKey).toBe(
			signInSecret(
				masterSubkeys(p, deriveMasterKey(p, PASSWORD, salt, ARGON2_FLOOR))
					.authKey,
			),
		);
	});

	it("settles a lost commit by the check route, and does not send it again once the link is spent", async () => {
		const s = setup({ commit: () => "lost" });
		const handle = await s.callbacks.begin(keyText);
		expect(
			await codeOf(s.callbacks.finish(handle, { password: PASSWORD })),
		).toBe("unconfirmed");
		await expect(
			s.callbacks.finish(handle, { password: PASSWORD }),
		).resolves.toBe("linkSpent");
		expect(s.to(COMMIT)).toHaveLength(1);
		expect(s.to(CHECK)).toHaveLength(1);
	});

	it("says a gone link at commit time as an expired link", async () => {
		const s = setup({ commit: () => problem("invalid_token", 404) });
		const handle = await s.callbacks.begin(keyText);
		expect(
			await codeOf(s.callbacks.finish(handle, { password: PASSWORD })),
		).toBe("tokenExpired");
	});

	it("says a key set that changed (409) and an account with no recovery key (409) apart", async () => {
		for (const [res, code] of [
			[problem("conflict", 409), "conflict"],
			[problem("recovery_unavailable", 409), "recoveryUnavailable"],
			[problem("too_many_requests", 429), "rateLimited"],
		] as const) {
			const s = setup({ commit: () => res });
			const handle = await s.callbacks.begin(keyText);
			expect(
				await codeOf(s.callbacks.finish(handle, { password: PASSWORD })),
			).toBe(code);
		}
	});

	it("sends the password typed at the retry after a rate limit, and the same request after a lost answer", async () => {
		const OTHER = "Another-Password-2027?";
		const secret = (body: Sent, password: string) => {
			const kdf = body.kdf as { salt: string };
			return signInSecret(
				masterSubkeys(
					p,
					deriveMasterKey(
						p,
						password,
						fromBase64Url(kdf.salt) as Uint8Array,
						ARGON2_FLOOR,
					),
				).authKey,
			);
		};
		const limited = setup({
			commit: (n) => (n === 0 ? problem("too_many_requests", 429) : null),
		});
		const first = await limited.callbacks.begin(keyText);
		expect(
			await codeOf(limited.callbacks.finish(first, { password: PASSWORD })),
		).toBe("rateLimited");
		await limited.callbacks.finish(first, { password: OTHER });
		const [, second] = limited.to(COMMIT);
		expect(second?.body.newAuthKey).toBe(secret(second?.body ?? {}, OTHER));

		const lost = setup({ commit: (n) => (n === 0 ? "lostLive" : null) });
		const again = await lost.callbacks.begin(keyText);
		await codeOf(lost.callbacks.finish(again, { password: PASSWORD }));
		await expect(
			lost.callbacks.finish(again, { password: OTHER }),
		).resolves.toBe("set");
		const [a, b] = lost.to(COMMIT);
		expect(lost.to(COMMIT)).toHaveLength(2);
		expect(b?.body).toEqual(a?.body);
	});
});
