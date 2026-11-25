// Make new key on the phone: what the typed API client is called with (the
// current sign-in secret to open the keys, the Idempotency-Key on the commit,
// the read-back) and what a server that does not hold the key gets called.
// The flow is packages/crypto/test/client-new-key-flow.test.ts; this file runs
// it through the phone's ports. The vector's account uses the floor's Argon2id
// parameters. Jest cannot load the native module, so react-native-libsodium is
// libsodium.js (same API).
import {
	fromBase64Url,
	fromHex,
	type Primitives,
	recoveryWrapDigest,
	SYMMETRIC_WRAP_BYTES,
	toBase64Url,
	wrapKey,
} from "@retrospend/crypto";
import { KeyFlowError } from "@retrospend/crypto/client";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { loadWebSodium } from "@retrospend/crypto/web";

jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/data/ids", () => ({ newClientId: () => "client-id" }));

type NewKey = typeof import("./new-key");
let h: NewKey;
let real: Primitives;

jest.setTimeout(120_000);

beforeAll(async () => {
	const sodium = await loadWebSodium();
	jest.doMock("react-native-libsodium", () => ({ ...sodium }));
	h = require("./new-key") as NewKey;
	real = await require("@/crypto/native").getPrimitives();
});

const MASTER = vectors.masters[1];
if (!MASTER) throw new Error("vector missing");
const USER = "0b1f2e3d-4c5b-4a69-8877-665544332211";
const AK = Uint8Array.from({ length: 32 }, (_, i) => 0x20 + i);
const KDF = {
	salt: toBase64Url(fromHex(MASTER.salt)),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};
const AUTH = toBase64Url(fromHex(MASTER.authKey));

const refusal = (status: number, code?: string) =>
	Object.assign(new Error("x"), { status, code });

type Sent = { currentAuthKey: string; wrappedRecoveryKey: string };

function rig(over: { store?: boolean; hang?: "commit" } = {}) {
	let wrap: Uint8Array = new Uint8Array(SYMMETRIC_WRAP_BYTES).fill(7);
	const pair = real.boxKeypair();
	const hung = { commit: 0 };
	const keys = jest.fn(async () => ({ kdf: KDF }));
	const openKeys = jest.fn(async (body: { authKey: string }, _o?: unknown) => {
		if (body.authKey !== AUTH) throw refusal(400, "wrong_password");
		return {
			version: 4,
			kdf: KDF,
			publicKey: toBase64Url(pair.publicKey),
			wraps: [
				{
					role: "ak-password",
					targetId: USER,
					wrapped: toBase64Url(
						wrapKey(real, fromHex(MASTER?.wrapKey ?? ""), "ak-password", USER, AK),
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
			recoveryWrapDigest: toBase64Url(recoveryWrapDigest(real, wrap)),
		};
	});
	const newRecoveryKey = jest.fn(async (body: Sent, _opts: unknown) => {
		if (over.hang === "commit" && hung.commit++ === 0) {
			return new Promise<never>(() => {});
		}
		if (over.store !== false)
			wrap = fromBase64Url(body.wrappedRecoveryKey) as Uint8Array;
		return { version: 5 };
	});
	const made = h.phoneNewKeyCallbacks(
		{
			api: { keys, openKeys, newRecoveryKey } as never,
			userId: USER,
			newKey: () => "idem-1",
		},
		{ primitives: async () => real, paint: async () => {} },
	);
	return { made, openKeys, newRecoveryKey };
}

const codeOf = async (run: Promise<unknown>): Promise<string> =>
	run.then(
		() => "none",
		(e: unknown) => (e instanceof KeyFlowError ? e.code : "other"),
	);

describe("phone Make new key", () => {
	it("opens the keys with the sign-in secret, sends the new wrap under an Idempotency-Key, and reads it back", async () => {
		const r = rig();
		const draft = await r.made.makeKey(MASTER.password);
		expect(draft.keyText.split("-")).toHaveLength(9);
		expect(r.newRecoveryKey).not.toHaveBeenCalled();
		await r.made.save(draft);
		expect(r.newRecoveryKey).toHaveBeenCalledTimes(1);
		const [body, opts] = r.newRecoveryKey.mock.calls[0] as [Sent, unknown];
		expect(opts).toEqual({
			context: { idempotencyKey: "idem-1" },
			signal: expect.anything(),
		});
		expect(body.currentAuthKey).toBe(AUTH);
		const wire = JSON.stringify(body);
		expect(wire).not.toContain(MASTER.password);
		expect(wire).not.toContain(draft.keyText);
		// One open to make the key, one to read it back.
		expect(r.openKeys).toHaveBeenCalledTimes(2);
	});

	it("says a wrong password as wrongPassword and sends nothing", async () => {
		const r = rig();
		expect(await codeOf(r.made.makeKey("not the password"))).toBe(
			"wrongPassword",
		);
		expect(r.newRecoveryKey).not.toHaveBeenCalled();
	});

	it("does not say saved for a key the server does not hold", async () => {
		const r = rig({ store: false });
		const draft = await r.made.makeKey(MASTER.password);
		expect(await codeOf(r.made.save(draft))).toBe("readBackFailed");
	});

	it("sends nothing once the draft is wiped", async () => {
		const r = rig();
		const draft = await r.made.makeKey(MASTER.password);
		draft.wipe();
		expect(await codeOf(r.made.save(draft))).toBe("failed");
		expect(r.newRecoveryKey).not.toHaveBeenCalled();
	});
});

describe("phone Make new key, a request that never answers", () => {
	afterEach(() => jest.useRealTimers());

	it("gives up on the keys read after 30 seconds as a network failure, with nothing sent", async () => {
		const r = rig();
		jest.useFakeTimers();
		(r.openKeys as jest.Mock).mockImplementationOnce(
			() => new Promise<never>(() => {}),
		);
		const made = codeOf(r.made.makeKey(MASTER.password));
		await jest.advanceTimersByTimeAsync(30_000);
		expect(await made).toBe("unavailable");
		expect(r.newRecoveryKey).not.toHaveBeenCalled();
	});

	it("ends a save whose commit never answers as an unknown outcome, then reads the server back before anything is sent again", async () => {
		const r = rig({ hang: "commit" });
		const draft = await r.made.makeKey(MASTER.password);
		jest.useFakeTimers();
		const first = codeOf(r.made.save(draft));
		await jest.advanceTimersByTimeAsync(30_000);
		expect(await first).toBe("unavailable");
		jest.useRealTimers();
		const opens = r.openKeys.mock.calls.length;
		// The read-back finds nothing stored, so the same key goes out again.
		await r.made.save(draft);
		expect(r.openKeys.mock.calls.length).toBeGreaterThan(opens);
		expect(r.newRecoveryKey).toHaveBeenCalledTimes(2);
		const [a, b] = r.newRecoveryKey.mock.calls.map((c) => c[0] as Sent);
		expect(b?.wrappedRecoveryKey).toBe(a?.wrappedRecoveryKey);
	});
});
