import {
	ARGON2_FLOOR,
	deriveMasterKey,
	fromBase64Url,
	masterSubkeys,
	type Primitives,
	recoveryWrapDigest,
	SYMMETRIC_WRAP_BYTES,
	signInSecret,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { KeyFlowError } from "@retrospend/crypto/client";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { webNewKeyCallbacks } from "./new-key";

// The web's side of Make new key: the routes and bodies it sends, the
// Idempotency-Key, and the read-back it asks for. The flow itself (the key made
// from the password, the check before sending, never sending again blind) is
// packages/crypto/test/client-new-key-flow.test.ts.
const ACCOUNT = {
	id: "0b1f2e3d-4c5b-4a69-8877-665544332211",
	email: "Person@Example.com",
};
const KEYS = "/api/v1/me/protection/keys";
const OPEN = "/api/v1/me/protection/keys/open";
const COMMIT = "/api/v1/me/protection/recovery-key";
const PASSWORD = "Correct-horse-9-battery";
const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0x30 + i);
const KDF = {
	salt: toBase64Url(SALT),
	memoryKiB: ARGON2_FLOOR.memoryKiB,
	passes: ARGON2_FLOOR.passes,
};

let p: Primitives;
let authKey: string;
let passwordWrap: string;
beforeAll(async () => {
	p = await createWebPrimitives();
	const mine = masterSubkeys(
		p,
		deriveMasterKey(p, PASSWORD, SALT, ARGON2_FLOOR),
	);
	authKey = signInSecret(mine.authKey);
	passwordWrap = toBase64Url(
		wrapKey(
			p,
			mine.wrapKey,
			"ak-password",
			ACCOUNT.id,
			Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i),
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

type Sent = Record<string, unknown>;

function setup(
	over: { commit?: (n: number) => "lost" | Response | null } = {},
) {
	const calls: { url: string; init: RequestInit | undefined; body: Sent }[] =
		[];
	let wrap = new Uint8Array(SYMMETRIC_WRAP_BYTES).fill(5);
	let commits = 0;
	const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const path = String(url);
		const body = init?.body ? (JSON.parse(String(init.body)) as Sent) : {};
		calls.push({ url: path, init, body });
		if (path === KEYS) return json({ kdf: KDF });
		if (path === OPEN) {
			if (body.authKey !== authKey) return problem("wrong_password", 400);
			return json({
				version: 4,
				kdf: KDF,
				wraps: [
					{ role: "ak-password", targetId: ACCOUNT.id, wrapped: passwordWrap },
				],
				recoveryWrapDigest: toBase64Url(recoveryWrapDigest(p, wrap)),
			});
		}
		if (path === COMMIT) {
			const outcome = over.commit?.(commits++) ?? null;
			if (outcome instanceof Response) return outcome;
			wrap = fromBase64Url(String(body.wrappedRecoveryKey)) as Uint8Array;
			if (outcome === "lost") throw new TypeError("connection lost");
			return json({ version: 5 });
		}
		return problem("not_found", 404);
	});
	const callbacks = webNewKeyCallbacks(ACCOUNT, {
		deps: {
			fetch: fetch as typeof globalThis.fetch,
			storage: null,
			paint: async () => {},
			primitives: async () => p,
			newKey: (() => {
				let n = 0;
				return () => `idem-${++n}`;
			})(),
		},
	});
	const to = (path: string) => calls.filter((c) => c.url === path);
	return { callbacks, calls, to };
}

const codeOf = async (run: Promise<unknown>) => {
	try {
		await run;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

describe("web Make new key", () => {
	it("reads the kdf from the keys route, proves the sign-in secret to keys/open, commits once under an Idempotency-Key, and reads the digest back", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKey(PASSWORD);
		await s.callbacks.save(draft);
		expect(s.calls.map((c) => c.url)).toEqual([KEYS, OPEN, COMMIT, OPEN]);
		const [commit] = s.to(COMMIT);
		const headers = commit?.init?.headers as Record<string, string>;
		expect(headers["idempotency-key"]).toBe("idem-1");
		expect(commit?.body.currentAuthKey).toBe(authKey);
		expect(commit?.body.baseVersion).toBe(4);
		expect(Object.keys(commit?.body ?? {}).sort()).toEqual([
			"baseVersion",
			"currentAuthKey",
			"recoveryAuthKey",
			"wrappedRecoveryKey",
		]);
		// Neither the password nor the key's text ever leaves the page.
		const sent = JSON.stringify(s.calls.map((c) => c.body));
		expect(sent).not.toContain(PASSWORD);
		expect(sent).not.toContain(draft.keyText);
		expect(draft.keyText.split("-")).toHaveLength(9);
	});

	it("says a wrong password and sends no commit", async () => {
		const s = setup();
		expect(await codeOf(s.callbacks.makeKey("not it"))).toBe("wrongPassword");
		expect(s.to(COMMIT)).toHaveLength(0);
	});

	it("reads a lost commit back and does not send it again when the server holds it", async () => {
		const s = setup({ commit: () => "lost" });
		const draft = await s.callbacks.makeKey(PASSWORD);
		expect(await codeOf(s.callbacks.save(draft))).toBe("unavailable");
		await s.callbacks.save(draft);
		expect(s.to(COMMIT)).toHaveLength(1);
	});

	it("reads a 409 back instead of sending it again, and says the keys changed when the server holds another wrap", async () => {
		const s = setup({ commit: () => problem("conflict", 409) });
		const draft = await s.callbacks.makeKey(PASSWORD);
		expect(await codeOf(s.callbacks.save(draft))).toBe("conflict");
		expect(s.to(COMMIT)).toHaveLength(1);
		// One open to make the key and one to read the 409 back.
		expect(s.to(OPEN)).toHaveLength(2);
	});

	it("sends nothing once the draft is wiped", async () => {
		const s = setup();
		const draft = await s.callbacks.makeKey(PASSWORD);
		draft.wipe();
		expect(await codeOf(s.callbacks.save(draft))).toBe("failed");
		expect(s.to(COMMIT)).toHaveLength(0);
	});
});
