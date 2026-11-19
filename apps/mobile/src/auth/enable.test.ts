// Turning on protection on the phone: what the typed API client is called
// with (the body, the Idempotency-Key, the read-back), signing in again for an
// old session, the words each refusal gets, and the keystore record. The flow
// itself (checks before sending, the digest, the words, the wiping) is
// packages/crypto/test/client-enable-flow.test.ts; this file runs it through
// the phone's ports with cheaper Argon2id parameters than the real ones. Jest
// cannot load the native module, so react-native-libsodium is libsodium.js
// (same API); the native Argon2id needs a run on a phone.
import {
	ARGON2_FLOOR,
	fromBase64Url,
	type Primitives,
	recoveryWrapDigest,
	toBase64Url,
} from "@retrospend/crypto";
import { failureCode, isFinalFailure } from "@retrospend/crypto/client";
import { loadWebSodium } from "@retrospend/crypto/web";
import type { SignInStep } from "./auth-api";
import type { PhoneEnableInput, SignInAgain } from "./enable";

// The contract's runtime is ESM, so the real password rules file (it imports
// nothing) stands in for it.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/data/ids", () => ({
	newClientId: (() => {
		let n = 0;
		return () => `client-${++n}`;
	})(),
}));

type Enable = typeof import("./enable");
let h: Enable;
let real: Primitives;

jest.setTimeout(120_000);

beforeAll(async () => {
	const sodium = await loadWebSodium();
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	h = require("./enable") as Enable;
	real = await require("@/crypto/native").getPrimitives();
});

const USER = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const EMAIL = "ana@example.com";
const BASE = "https://retrospend.app";
const OLD = "my old password";
const NEW = "A brand new passphrase 7";

const refusal = (status: number, code?: string) =>
	Object.assign(new Error("x"), { status, code });

type Sent = {
	wraps: { role: string; targetId: string; wrapped: string }[];
	kdf: unknown;
	publicKey: string;
	authKey: string;
	currentPassword: string;
	totpCode?: string;
};

function rig(
	script: {
		enable?: (n: number) => void;
		spoil?: (answer: Record<string, unknown>) => void;
		open?: () => unknown;
		session?: SignInAgain;
	} = {},
) {
	let stored: Sent | null = null;
	let enables = 0;
	const enable = jest.fn(async (body: Sent, _opts: unknown) => {
		script.enable?.(enables++);
		stored = body;
		return { version: 1, createdAt: "2026-11-19T10:00:00Z", signedOut: 0 };
	});
	const openKeys = jest.fn(async (_body: { authKey: string }) => {
		if (script.open) return script.open();
		const s = stored as Sent;
		const wrap = (role: string) => ({
			id: "id",
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
			wraps: [wrap("ak-password"), wrap("private-key"), wrap("collection-key")],
			recoveryWrapDigest: toBase64Url(recoveryWrapDigest(real, recovery)),
		};
		script.spoil?.(answer);
		return answer;
	});
	const items = new Map<string, string>();
	const session: SignInAgain = script.session ?? {
		signIn: jest.fn(async (): Promise<SignInStep> => ({ status: "signedIn" })),
		verifyCode: jest.fn(
			async (): Promise<SignInStep> => ({ status: "signedIn" }),
		),
	};
	const input: PhoneEnableInput = {
		api: { enable, openKeys } as unknown as PhoneEnableInput["api"],
		baseUrl: BASE,
		email: EMAIL,
		userId: USER,
		session: () => session,
		newKey: (() => {
			let n = 0;
			return () => `idem-${++n}`;
		})(),
	};
	const made = h.phoneEnableCallbacks(
		input,
		{
			primitives: async () => real,
			paint: async () => {},
			store: {
				getItemAsync: async (k) => items.get(k) ?? null,
				setItemAsync: async (k, v) => void items.set(k, v),
				deleteItemAsync: async (k) => void items.delete(k),
			},
		},
		ARGON2_FLOOR,
	);
	return { made, enable, openKeys, items, session };
}

const code = async (run: Promise<unknown>) =>
	failureCode(
		await run.then(
			() => null,
			(e: unknown) => e,
		),
	);

describe("phone enable", () => {
	it("sends the typed password and the keys once, then reads them back with the new sign-in secret", async () => {
		const r = rig();
		const draft = await r.made.makeKeys(NEW);
		expect(r.enable).not.toHaveBeenCalled();
		await r.made.save(draft, { password: OLD, code: null });

		expect(r.enable).toHaveBeenCalledTimes(1);
		const [body, opts] = r.enable.mock.calls[0] as [Sent, unknown];
		expect(opts).toEqual({ context: { idempotencyKey: "idem-1" } });
		expect(body.currentPassword).toBe(OLD);
		expect("totpCode" in body).toBe(false);
		expect(body.wraps).toHaveLength(4);
		expect(JSON.stringify(body)).not.toContain(NEW);
		expect(JSON.stringify(body)).not.toContain(draft.keyText);

		expect(r.openKeys).toHaveBeenCalledWith({ authKey: body.authKey });
		// Recorded as keyed in the keystore, under a hash of the address.
		expect([...r.items.values()]).toEqual(["1"]);
		expect([...r.items.keys()][0]).not.toContain("ana");
	});

	it("sends the code when there is one, and a retry keeps the Idempotency-Key", async () => {
		const r = rig({
			enable: (n) => {
				if (n === 0) throw refusal(500, "server_error");
			},
		});
		const draft = await r.made.makeKeys(NEW);
		expect(
			await code(r.made.save(draft, { password: OLD, code: "123456" })),
		).toBe("failed");
		await r.made.save(draft, { password: OLD, code: "654321" });
		const calls = r.enable.mock.calls as [
			Sent,
			{ context: { idempotencyKey: string } },
		][];
		expect(calls.map((c) => c[1].context.idempotencyKey)).toEqual([
			"idem-1",
			"idem-1",
		]);
		expect(calls.map((c) => c[0].totpCode)).toEqual(["123456", "654321"]);
		expect(r.openKeys).toHaveBeenCalledTimes(1);
	});

	it("is a final error when the server answers another ak-recovery digest", async () => {
		const r = rig({
			spoil: (a) => {
				const d = fromBase64Url(a.recoveryWrapDigest as string) as Uint8Array;
				d[0] = (d[0] ?? 0) ^ 1;
				a.recoveryWrapDigest = toBase64Url(d);
			},
		});
		const draft = await r.made.makeKeys(NEW);
		const c = await code(r.made.save(draft, { password: OLD, code: null }));
		expect(c).toBe("checkFailed");
		expect(isFinalFailure(c as "checkFailed")).toBe(true);
		// The keys are on the server: this phone remembers it.
		expect([...r.items.values()]).toEqual(["1"]);
	});

	it("is a final error when the read-back is refused", async () => {
		for (const error of [
			refusal(400, "wrong_password"),
			refusal(429),
			refusal(500),
		]) {
			const r = rig({
				open: () => {
					throw error;
				},
			});
			const draft = await r.made.makeKeys(NEW);
			expect(
				await code(r.made.save(draft, { password: OLD, code: null })),
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
			const r = rig({
				enable: () => {
					throw refusal(status, c);
				},
			});
			const draft = await r.made.makeKeys(NEW);
			expect(
				await code(r.made.save(draft, { password: OLD, code: null })),
			).toBe(expected);
			expect(r.openKeys).not.toHaveBeenCalled();
			expect(r.items.size).toBe(0);
		},
	);

	it("says it could not be reached when there is no answer at all", async () => {
		const r = rig({
			enable: () => {
				throw new TypeError("offline");
			},
		});
		const draft = await r.made.makeKeys(NEW);
		expect(await code(r.made.save(draft, { password: OLD, code: null }))).toBe(
			"failed",
		);
	});
});

describe("an old session", () => {
	const stale = (n: number) => {
		if (n === 0) throw refusal(403, "session_not_fresh");
	};
	const session = (
		signIn: SignInStep,
		verify: SignInStep = { status: "signedIn" },
	): SignInAgain & { calls: string[] } => {
		const calls: string[] = [];
		return {
			calls,
			signIn: jest.fn(async (e: string, p: string) => {
				calls.push(`signIn ${e} ${p}`);
				return signIn;
			}),
			verifyCode: jest.fn(async (c: string) => {
				calls.push(`verify ${c}`);
				return verify;
			}),
		};
	};

	it("signs in again with the typed password and sends the same request again", async () => {
		const s = session({ status: "signedIn" });
		const r = rig({ enable: stale, session: s });
		const draft = await r.made.makeKeys(NEW);
		await r.made.save(draft, { password: OLD, code: null });
		expect(s.calls).toEqual([`signIn ${EMAIL} ${OLD}`]);
		const calls = r.enable.mock.calls as [
			Sent,
			{ context: { idempotencyKey: string } },
		][];
		expect(calls).toHaveLength(2);
		expect(calls[1]?.[1].context.idempotencyKey).toBe(
			calls[0]?.[1].context.idempotencyKey,
		);
		expect(calls[1]?.[0]).toEqual(calls[0]?.[0]);
		expect(r.openKeys).toHaveBeenCalledTimes(1);
	});

	it("asks for the code next when the account has two-factor", async () => {
		const s = session({ status: "twoFactor" });
		const r = rig({ enable: stale, session: s });
		const draft = await r.made.makeKeys(NEW);
		await r.made.save(draft, { password: OLD, code: "123456" });
		expect(s.calls).toEqual([`signIn ${EMAIL} ${OLD}`, "verify 123456"]);
	});

	it.each([
		[
			"a wrong password",
			{ status: "error", reason: "invalidCredentials" },
			undefined,
			"wrongPassword",
		],
		[
			"a rate limit",
			{ status: "error", reason: "rateLimited" },
			undefined,
			"tooMany",
		],
		["no network", { status: "error", reason: "network" }, undefined, "failed"],
		[
			"a wrong code",
			{ status: "twoFactor" },
			{ status: "error", reason: "invalidCode" },
			"wrongCode",
		],
	] as const)(
		"words %s while signing in again as %s and does not send twice",
		async (_n, first, then, expected) => {
			const s = session(first as SignInStep, then as SignInStep | undefined);
			const r = rig({ enable: stale, session: s });
			const draft = await r.made.makeKeys(NEW);
			expect(
				await code(r.made.save(draft, { password: OLD, code: "123456" })),
			).toBe(expected);
			expect(r.enable).toHaveBeenCalledTimes(1);
			expect(r.openKeys).not.toHaveBeenCalled();
		},
	);
});
