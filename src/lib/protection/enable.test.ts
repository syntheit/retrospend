import {
	ARGON2_FLOOR,
	fromBase64Url,
	type Primitives,
	recoveryWrapDigest,
	toBase64Url,
} from "@retrospend/crypto";
import { failureCode, isFinalFailure } from "@retrospend/crypto/client";
import { createWebPrimitives } from "@retrospend/crypto/web";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type RefreshStep,
	type SessionRefresh,
	webEnableCallbacks,
} from "./enable";

// The web's side of turning on protection: the routes and bodies it sends, the
// Idempotency-Key, the read-back it asks for, signing in again for an old
// session, and the record. The flow itself (checks before sending, the
// digest, the words each failure gets, the wiping) is
// packages/crypto/test/client-enable-flow.test.ts; this file runs it through
// the web ports with a scripted server and cheaper parameters than the real ones.
const ACCOUNT = {
	id: "0b1f2e3d-4c5b-4a69-8877-665544332211",
	email: "Person@Example.com",
};
const ENABLE = "/api/v1/me/protection/enable";
const OPEN = "/api/v1/me/protection/keys/open";
const OLD = "my old password";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const problem = (code: string, status: number) =>
	json({ code, status }, status);

type Sent = Record<string, unknown> & {
	wraps: { role: string; targetId: string; wrapped: string }[];
	kdf: unknown;
	publicKey: string;
	authKey: string;
};

type Script = {
	enable?: (n: number) => Response | null;
	spoil?: (answer: Record<string, unknown>) => void;
	open?: () => Response;
};

function setup(script: Script = {}, session?: SessionRefresh) {
	const calls: { url: string; init: RequestInit | undefined; body: Sent }[] =
		[];
	const store = new Map<string, string>();
	let stored: Sent | null = null;
	let enables = 0;
	const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const path = String(url);
		const body = JSON.parse(String(init?.body)) as Sent;
		calls.push({ url: path, init, body });
		if (path === "/api/v1/auth/prelogin") return json({ kdf: null });
		if (path === ENABLE) {
			const refused = script.enable?.(enables++);
			if (refused) return refused;
			stored = body;
			return json({
				version: 1,
				createdAt: "2026-11-19T10:00:00Z",
				signedOut: 0,
			});
		}
		if (path === OPEN) {
			if (script.open) return script.open();
			if (!stored) return problem("not_found", 404);
			const s = stored;
			const wrap = (role: string) => ({
				id: crypto.randomUUID(),
				...s.wraps.find((w) => w.role === role),
			});
			const recovery = fromBase64Url(
				s.wraps.find((w) => w.role === "ak-recovery")?.wrapped ?? "",
			) as Uint8Array;
			const answer: Record<string, unknown> = {
				version: 1,
				createdAt: "2026-11-19T10:00:00Z",
				kdf: s.kdf,
				publicKey: s.publicKey,
				wraps: [
					wrap("ak-password"),
					wrap("private-key"),
					wrap("collection-key"),
				],
				recoveryWrapDigest: toBase64Url(recoveryWrapDigest(p, recovery)),
			};
			script.spoil?.(answer);
			return json(answer);
		}
		return problem("not_found", 404);
	});
	const made = webEnableCallbacks(ACCOUNT, {
		params: ARGON2_FLOOR,
		deps: {
			fetch: fetch as typeof globalThis.fetch,
			storage: {
				getItem: (k) => store.get(k) ?? null,
				setItem: (k, v) => void store.set(k, v),
				removeItem: (k) => void store.delete(k),
			},
			paint: async () => {},
			primitives: async () => p,
			newKey: (() => {
				let n = 0;
				return () => `idem-${++n}`;
			})(),
			...(session ? { session } : {}),
		},
	});
	const to = (path: string) => calls.filter((c) => c.url === path);
	return { made, calls, to, store };
}

const headerOf = (
	c: { init: RequestInit | undefined } | undefined,
	name: string,
) => (c?.init?.headers as Record<string, string> | undefined)?.[name];

const code = async (run: Promise<unknown>) =>
	failureCode(
		await run.then(
			() => null,
			(e: unknown) => e,
		),
	);

describe("web enable", () => {
	it("sends the typed password and the keys once, then reads them back with the new sign-in secret", async () => {
		const t = setup();
		const draft = await t.made.makeKeys("A brand new passphrase 7");
		expect(t.calls).toHaveLength(0);
		await t.made.save(draft, { password: OLD, code: null });

		const enable = t.to(ENABLE);
		expect(enable).toHaveLength(1);
		expect(enable[0]?.init?.method).toBe("POST");
		expect(headerOf(enable[0], "idempotency-key")).toBe("idem-1");
		expect(enable[0]?.init?.credentials).toBe("same-origin");
		expect(enable[0]?.body.currentPassword).toBe(OLD);
		expect("totpCode" in (enable[0]?.body ?? {})).toBe(false);
		expect(enable[0]?.body.wraps).toHaveLength(4);
		expect(JSON.stringify(enable[0]?.body)).not.toContain(
			"A brand new passphrase 7",
		);

		// Read back with the sign-in secret the server now holds, and no key.
		const open = t.to(OPEN);
		expect(open).toHaveLength(1);
		expect(open[0]?.body).toEqual({ authKey: enable[0]?.body.authKey });
		expect(headerOf(open[0], "idempotency-key")).toBeUndefined();
		// The address is recorded as keyed, under a hash of it.
		expect([...t.store.values()]).toEqual(["1"]);
		expect([...t.store.keys()][0]).not.toContain("example");
	});

	it("sends the two-factor code when there is one, and a retry keeps the Idempotency-Key", async () => {
		const t = setup({
			enable: (n) => (n === 0 ? problem("server_error", 500) : null),
		});
		const draft = await t.made.makeKeys("A brand new passphrase 7");
		expect(
			await code(t.made.save(draft, { password: OLD, code: "123456" })),
		).toBe("failed");
		await t.made.save(draft, { password: OLD, code: "654321" });
		const enable = t.to(ENABLE);
		expect(enable.map((c) => headerOf(c, "idempotency-key"))).toEqual([
			"idem-1",
			"idem-1",
		]);
		expect(enable.map((c) => c.body.totpCode)).toEqual(["123456", "654321"]);
		// Nothing was recorded or read back for the refused attempt.
		expect(t.to(OPEN)).toHaveLength(1);
	});

	it("is a final error when the server answers another ak-recovery digest", async () => {
		const t = setup({
			spoil: (answer) => {
				const d = fromBase64Url(
					answer.recoveryWrapDigest as string,
				) as Uint8Array;
				d[0] = (d[0] ?? 0) ^ 1;
				answer.recoveryWrapDigest = toBase64Url(d);
			},
		});
		const draft = await t.made.makeKeys("A brand new passphrase 7");
		const c = await code(t.made.save(draft, { password: OLD, code: null }));
		expect(c).toBe("checkFailed");
		expect(isFinalFailure(c as "checkFailed")).toBe(true);
		// The account is keyed on the server: this browser remembers it.
		expect([...t.store.values()]).toEqual(["1"]);
	});

	it("is a final error when the read-back is refused or cannot be reached", async () => {
		for (const open of [
			() => problem("wrong_password", 400),
			() => problem("rate_limited", 429),
			() => problem("server_error", 500),
		]) {
			const t = setup({ open });
			const draft = await t.made.makeKeys("A brand new passphrase 7");
			expect(
				await code(t.made.save(draft, { password: OLD, code: null })),
			).toBe("checkFailed");
		}
	});

	it.each([
		[400, "wrong_password", "wrongPassword"],
		[400, "wrong_two_factor_code", "wrongCode"],
		[400, "two_factor_required", "wrongCode"],
		[429, "rate_limited", "tooMany"],
		[501, "not_implemented", "notOffered"],
		[409, "conflict", "failed"],
		[403, "email_not_verified", "failed"],
		[500, "server_error", "failed"],
	])(
		"words a %s %s from the enable route as %s",
		async (status, c, expected) => {
			const t = setup({ enable: () => problem(c, status) });
			const draft = await t.made.makeKeys("A brand new passphrase 7");
			expect(
				await code(t.made.save(draft, { password: OLD, code: null })),
			).toBe(expected);
			expect(t.to(OPEN)).toHaveLength(0);
			expect(t.store.size).toBe(0);
		},
	);

	it("says it could not be reached when the network fails", async () => {
		const broken = webEnableCallbacks(ACCOUNT, {
			params: ARGON2_FLOOR,
			deps: {
				fetch: (() => Promise.reject(new TypeError("offline"))) as typeof fetch,
				storage: null,
				paint: async () => {},
				primitives: async () => p,
			},
		});
		const other = await broken.makeKeys("A brand new passphrase 7");
		expect(await code(broken.save(other, { password: OLD, code: null }))).toBe(
			"failed",
		);
	});
});

describe("an old session", () => {
	const session = (steps: { signIn: RefreshStep; verify?: RefreshStep }) => {
		const calls: string[] = [];
		const refresh: SessionRefresh = {
			signIn: vi.fn(async (email, password): Promise<RefreshStep> => {
				calls.push(`signIn ${email} ${password}`);
				return steps.signIn;
			}),
			verifyCode: vi.fn(async (c): Promise<RefreshStep> => {
				calls.push(`verify ${c}`);
				return steps.verify ?? { status: "signedIn" };
			}),
		};
		return { refresh, calls };
	};
	const stale = (n: number) =>
		n === 0 ? problem("session_not_fresh", 403) : null;

	it("signs in again with the typed password and sends the same request again", async () => {
		const s = session({ signIn: { status: "signedIn" } });
		const t = setup({ enable: stale }, s.refresh);
		const draft = await t.made.makeKeys("A brand new passphrase 7");
		await t.made.save(draft, { password: OLD, code: null });
		expect(s.calls).toEqual([`signIn person@example.com ${OLD}`]);
		const enable = t.to(ENABLE);
		expect(enable).toHaveLength(2);
		expect(headerOf(enable[1], "idempotency-key")).toBe(
			headerOf(enable[0], "idempotency-key"),
		);
		expect(enable[1]?.body).toEqual(enable[0]?.body);
		expect(t.to(OPEN)).toHaveLength(1);
	});

	it("asks for the code next when the account has two-factor", async () => {
		const s = session({ signIn: { status: "twoFactor" } });
		const t = setup({ enable: stale }, s.refresh);
		const draft = await t.made.makeKeys("A brand new passphrase 7");
		await t.made.save(draft, { password: OLD, code: "123456" });
		expect(s.calls).toEqual([
			`signIn person@example.com ${OLD}`,
			"verify 123456",
		]);
	});

	it.each([
		[
			"a wrong password",
			{ signIn: { status: "error", httpStatus: 401 } },
			"wrongPassword",
		],
		[
			"a rate limit",
			{ signIn: { status: "error", httpStatus: 429 } },
			"tooMany",
		],
		["no network", { signIn: { status: "error", httpStatus: null } }, "failed"],
		[
			"a wrong code",
			{
				signIn: { status: "twoFactor" },
				verify: { status: "error", httpStatus: 401 },
			},
			"wrongCode",
		],
	] as const)(
		"words %s while signing in again as %s and does not send twice",
		async (_n, steps, expected) => {
			const s = session(steps as { signIn: RefreshStep; verify?: RefreshStep });
			const t = setup({ enable: stale }, s.refresh);
			const draft = await t.made.makeKeys("A brand new passphrase 7");
			expect(
				await code(t.made.save(draft, { password: OLD, code: "123456" })),
			).toBe(expected);
			expect(t.to(ENABLE)).toHaveLength(1);
			expect(t.to(OPEN)).toHaveLength(0);
		},
	);
});
