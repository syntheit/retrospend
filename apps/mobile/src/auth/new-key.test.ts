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

function rig(over: { store?: boolean } = {}) {
	let wrap: Uint8Array = new Uint8Array(SYMMETRIC_WRAP_BYTES).fill(7);
	const keys = jest.fn(async () => ({ kdf: KDF }));
	const openKeys = jest.fn(async (body: { authKey: string }) => {
		if (body.authKey !== AUTH) throw refusal(400, "wrong_password");
		return {
			version: 4,
			kdf: KDF,
			wraps: [
				{
					role: "ak-password",
					targetId: USER,
					wrapped: toBase64Url(
						wrapKey(real, fromHex(MASTER?.wrapKey ?? ""), "ak-password", USER, AK),
					),
				},
			],
			recoveryWrapDigest: toBase64Url(recoveryWrapDigest(real, wrap)),
		};
	});
	const newRecoveryKey = jest.fn(async (body: Sent, _opts: unknown) => {
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
		expect(opts).toEqual({ context: { idempotencyKey: "idem-1" } });
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
