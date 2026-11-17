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
} from "@retrospend/crypto";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it, vi } from "vitest";
// Deep path: the index leaves out the nonce-taking wrap, which a vector needs.
import { wrapKeyWithNonce } from "../../../packages/crypto/src/keys";
import vectors from "../../../packages/crypto/vectors/keys.vectors.json";
import {
	PasswordRotationError,
	type RotateDeps,
	rotatePassword,
	SignInSecretError,
} from "./sign-in-secret";

// The old password, salt and parameters are the second master vector (floor
// parameters, known answers from a generator that shares no code with the
// app). The account key and the wrap's id and nonce are the ak-password wrap
// vector's. The stored wrap is that key sealed under the vector's own wrap key,
// the way enable would have stored it.
const MASTER = vectors.masters[1];
const WRAP = vectors.symmetricWraps.find((w) => w.role === "ak-password");
if (!MASTER || !WRAP) throw new Error("vector missing");
const USER_ID = WRAP.id;
const AK = fromHex(WRAP.key);
const OLD_KDF = {
	salt: toBase64Url(fromHex(MASTER.salt)),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};
const OLD_AUTH_KEY = toBase64Url(fromHex(MASTER.authKey));
const NEXT = "A brand new passphrase 7";

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

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const problem = (code: string, status: number) =>
	json({ code, status }, status);

const BEGIN = "/api/v1/me/protection/password/begin";
const COMMIT = "/api/v1/me/protection/password";

type Call = { url: string; init: RequestInit | undefined };
type Server = {
	begin?: (n: number) => Response;
	commit?: (n: number) => Response;
	keys?: () => Response;
	beginWrap?: () => string;
};

/** The server's side of the two routes, with the vector's account as the stored state. */
function setup(server: Server = {}) {
	const calls: Call[] = [];
	const count = { begin: 0, commit: 0 };
	const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const path = String(url);
		calls.push({ url: path, init });
		if (path === "/api/v1/me/protection/keys")
			return (
				server.keys?.() ??
				json({ createdAt: "2026-11-16T00:00:00Z", version: 3, kdf: OLD_KDF })
			);
		const body = JSON.parse(String(init?.body)) as Record<string, string>;
		if (path === BEGIN) {
			const n = count.begin++;
			if (server.begin) return server.begin(n);
			if (body.currentAuthKey !== OLD_AUTH_KEY)
				return problem("wrong_password", 400);
			return json({
				version: 3,
				kdf: OLD_KDF,
				wrappedAccountKey: server.beginWrap?.() ?? oldWrap,
			});
		}
		const n = count.commit++;
		return server.commit?.(n) ?? json({ version: 4, signedOut: 0 });
	});
	const posted = (path: string) => calls.filter((c) => c.url === path);
	const bodyOf = (c: Call | undefined) =>
		JSON.parse(String(c?.init?.body)) as {
			currentAuthKey: string;
			newAuthKey: string;
			kdf: { salt: string; memoryKiB: number; passes: number };
			wrappedAccountKey: string;
			baseVersion: number;
		};
	const run = (current: string, next: string, deps: Partial<RotateDeps> = {}) =>
		rotatePassword(USER_ID, current, next, {
			deps: {
				fetch: fetch as typeof globalThis.fetch,
				storage: null,
				paint: async () => {},
				newParams: ARGON2_FLOOR,
				...deps,
			},
		});
	return { fetch, calls, posted, bodyOf, run };
}

const keyOf = (c: Call | undefined): string | undefined =>
	(c?.init?.headers as Record<string, string> | undefined)?.["idempotency-key"];

const failure = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof PasswordRotationError || e instanceof SignInSecretError
			? e.code
			: "other";
	}
	return "none";
};

/** What the new password opens, from the values a commit carried. */
function open(
	sent: ReturnType<ReturnType<typeof setup>["bodyOf"]>,
	password: string,
) {
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
		const t = setup();
		await t.run(MASTER.password, NEXT);

		// Begin got the auth key the vector says the old password makes.
		const beginBody = JSON.parse(String(t.posted(BEGIN)[0]?.init?.body));
		expect(beginBody).toEqual({
			currentAuthKey: OLD_AUTH_KEY,
		});

		const commit = t.posted(COMMIT);
		expect(commit).toHaveLength(1);
		const sent = t.bodyOf(commit[0]);
		expect(sent.currentAuthKey).toBe(OLD_AUTH_KEY);
		expect(sent.baseVersion).toBe(3);
		expect(sent.kdf.salt).not.toBe(OLD_KDF.salt);
		expect(fromBase64Url(sent.kdf.salt)).toHaveLength(16);

		const now = open(sent, NEXT);
		expect(sent.newAuthKey).toBe(now.authKey);
		expect(sent.newAuthKey).not.toBe(sent.currentAuthKey);
		expect(now.accountKey()).toEqual(AK);
		// The old password no longer opens the new wrap.
		const before = open(sent, MASTER.password);
		expect(() => before.accountKey()).toThrow();
		expect(before.authKey).not.toBe(sent.newAuthKey);

		// Neither typed password goes to the server, only what was derived.
		const wire = JSON.stringify(t.calls.map((c) => c.init?.body));
		expect(wire).not.toContain(NEXT);
		expect(wire).not.toContain(MASTER.password);
	});

	it("sends a fresh Idempotency-Key on the commit and none on begin", async () => {
		const t = setup();
		await t.run(MASTER.password, NEXT);
		expect(keyOf(t.posted(BEGIN)[0])).toBeUndefined();
		expect(keyOf(t.posted(COMMIT)[0])).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("makes the new key set with the default Argon2id parameters", async () => {
		const t = setup();
		await t.run(MASTER.password, NEXT, { newParams: undefined });
		const sent = t.bodyOf(t.posted(COMMIT)[0]);
		expect(sent.kdf.memoryKiB).toBe(ARGON2_DEFAULT.memoryKiB);
		expect(sent.kdf.passes).toBe(ARGON2_DEFAULT.passes);
		expect(open(sent, NEXT).accountKey()).toEqual(AK);
	}, 60_000);

	it("a wrong old password stops at begin with its own code and sends no commit", async () => {
		const t = setup();
		expect(await failure(t.run("not the password", NEXT))).toBe(
			"wrongPassword",
		);
		expect(t.posted(BEGIN)).toHaveLength(1);
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("names a rate limit and sends no commit", async () => {
		const t = setup({ begin: () => problem("rate_limited", 429) });
		expect(await failure(t.run(MASTER.password, NEXT))).toBe("rateLimited");
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("refuses to send a new wrap that does not open, and posts no commit", async () => {
		const t = setup();
		// The only seal in the run is the new wrap: one flipped byte in it.
		const primitives = async () => ({
			...p,
			aeadEncrypt: (...args: Parameters<Primitives["aeadEncrypt"]>) => {
				const out = p.aeadEncrypt(...args);
				out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		});
		expect(await failure(t.run(MASTER.password, NEXT, { primitives }))).toBe(
			"unavailable",
		);
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("refuses to send a new wrap that opens to a different account key, and posts no commit", async () => {
		const t = setup();
		// The seal succeeds and opens, but holds other bytes than the account key.
		const primitives = async () => ({
			...p,
			aeadEncrypt: (...args: Parameters<Primitives["aeadEncrypt"]>) => {
				const [key, nonce, , aad] = args;
				return p.aeadEncrypt(key, nonce, p.randomBytes(32), aad);
			},
		});
		expect(await failure(t.run(MASTER.password, NEXT, { primitives }))).toBe(
			"unavailable",
		);
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("names a server that does not offer protection, on begin and on commit, without a retry", async () => {
		const noBegin = setup({ begin: () => problem("not_implemented", 501) });
		expect(await failure(noBegin.run(MASTER.password, NEXT))).toBe(
			"notOffered",
		);
		expect(noBegin.posted(BEGIN)).toHaveLength(1);
		expect(noBegin.posted(COMMIT)).toHaveLength(0);
		const noCommit = setup({ commit: () => problem("not_implemented", 501) });
		expect(await failure(noCommit.run(MASTER.password, NEXT))).toBe(
			"notOffered",
		);
		expect(noCommit.posted(COMMIT)).toHaveLength(1);
	});

	it("refuses to send a new auth key that the new password does not make again", async () => {
		const t = setup();
		// kdfDerive runs old auth, old wrap, new auth, new wrap, check auth, check
		// wrap: damage the third, so the sent key differs from the re-derived one.
		let n = 0;
		const primitives = async () => ({
			...p,
			kdfDerive: (...args: Parameters<Primitives["kdfDerive"]>) => {
				const out = p.kdfDerive(...args);
				if (++n === 3) out[0] = (out[0] ?? 0) ^ 1;
				return out;
			},
		});
		expect(await failure(t.run(MASTER.password, NEXT, { primitives }))).toBe(
			"unavailable",
		);
		expect(n).toBeGreaterThanOrEqual(6);
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("refuses a begin wrap that does not open under the old password, and sends nothing", async () => {
		const bad = fromBase64Url(oldWrap) as Uint8Array;
		bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
		const t = setup({ beginWrap: () => toBase64Url(bad) });
		expect(await failure(t.run(MASTER.password, NEXT))).toBe("unavailable");
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("starts over once on a conflict, with a new Idempotency-Key", async () => {
		const t = setup({
			commit: (n) =>
				n === 0 ? problem("conflict", 409) : json({ version: 4, signedOut: 1 }),
		});
		await t.run(MASTER.password, NEXT);
		expect(t.posted(BEGIN)).toHaveLength(2);
		const commits = t.posted(COMMIT);
		expect(commits).toHaveLength(2);
		expect(keyOf(commits[0])).not.toBe(keyOf(commits[1]));
		// The second run made its own salt.
		expect(t.bodyOf(commits[0]).kdf.salt).not.toBe(
			t.bodyOf(commits[1]).kdf.salt,
		);
	});

	it("a second conflict is the answer, after one full second run", async () => {
		const t = setup({ commit: () => problem("conflict", 409) });
		expect(await failure(t.run(MASTER.password, NEXT))).toBe("conflict");
		expect(t.posted(BEGIN)).toHaveLength(2);
		expect(t.posted(COMMIT)).toHaveLength(2);
	});

	it("does not retry anything but a conflict", async () => {
		const t = setup({ commit: () => problem("wrong_password", 400) });
		expect(await failure(t.run(MASTER.password, NEXT))).toBe("wrongPassword");
		expect(t.posted(COMMIT)).toHaveLength(1);
		const u = setup({ commit: () => json({}, 500) });
		expect(await failure(u.run(MASTER.password, NEXT))).toBe("unavailable");
		expect(u.posted(COMMIT)).toHaveLength(1);
	});

	it("treats a key set that changed between the keys route and begin as a conflict", async () => {
		const t = setup({
			begin: () =>
				json({
					version: 3,
					kdf: { ...OLD_KDF, passes: OLD_KDF.passes + 1 },
					wrappedAccountKey: oldWrap,
				}),
		});
		expect(await failure(t.run(MASTER.password, NEXT))).toBe("conflict");
		expect(t.posted(COMMIT)).toHaveLength(0);
	});

	it("refuses an account the keys route says has no keys, before any derivation", async () => {
		const paint = vi.fn(async () => {});
		const t = setup({ keys: () => json({}, 404) });
		expect(await failure(t.run(MASTER.password, NEXT, { paint }))).toBe(
			"downgrade",
		);
		expect(paint).not.toHaveBeenCalled();
		expect(t.posted(BEGIN)).toHaveLength(0);
	});

	it("refuses parameters outside the allowed range before any derivation", async () => {
		const paint = vi.fn(async () => {});
		const t = setup({
			keys: () =>
				json({
					createdAt: "x",
					version: 3,
					kdf: { ...OLD_KDF, memoryKiB: 1024 },
				}),
		});
		expect(await failure(t.run(MASTER.password, NEXT, { paint }))).toBe(
			"params",
		);
		expect(paint).not.toHaveBeenCalled();
		expect(t.posted(BEGIN)).toHaveLength(0);
	});

	it("wipes every key it derived or opened, on success and on a refusal", async () => {
		const kept: Uint8Array[] = [];
		const watch = async () => ({
			...p,
			argon2id: (...args: Parameters<Primitives["argon2id"]>) =>
				track(p.argon2id(...args)),
			kdfDerive: (...args: Parameters<Primitives["kdfDerive"]>) =>
				track(p.kdfDerive(...args)),
			aeadDecrypt: (...args: Parameters<Primitives["aeadDecrypt"]>) =>
				track(p.aeadDecrypt(...args)),
		});
		const track = (bytes: Uint8Array) => {
			kept.push(bytes);
			return bytes;
		};
		const allZero = () => kept.every((b) => b.every((x) => x === 0));

		await setup().run(MASTER.password, NEXT, { primitives: watch });
		// Three derivations (old, new, check), six subkeys, the opened account
		// key twice.
		expect(kept).toHaveLength(3 + 6 + 2);
		expect(kept.every((b) => b.length === 32)).toBe(true);
		expect(allZero()).toBe(true);

		kept.length = 0;
		const t = setup({ commit: () => problem("wrong_password", 400) });
		await failure(t.run(MASTER.password, NEXT, { primitives: watch }));
		expect(kept.length).toBeGreaterThan(0);
		expect(allZero()).toBe(true);
	});
});
