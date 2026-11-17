// The shared sign-in secret flow (src/client/secret.ts) against fake ports,
// with the F3 key vectors: the second master vector uses the floor parameters,
// and its auth key is a known answer from a generator that shares no code
// with the package. The web and the phone run these same functions; their own
// tests cover only how each fills in the ports.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fromHex, type Primitives, toBase64Url } from "../src";
import {
	accountIsKeyed,
	deriveSignInSecret,
	type FlowPorts,
	type Kdf,
	KeyFlowError,
	signInSecretFor,
} from "../src/client";
import { createWebPrimitives } from "../src/web";
import vectors from "../vectors/keys.vectors.json";

const MASTER = vectors.masters[1];
if (!MASTER) throw new Error("vector missing");
const KDF: Kdf = {
	salt: toBase64Url(fromHex(MASTER.salt)),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};
const EXPECTED = toBase64Url(fromHex(MASTER.authKey));
const TYPED = "Plain-pw-1";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

type Over = {
	kdf?: Kdf | null;
	/** The raw answer body, instead of `{ kdf }`. */
	body?: unknown;
	/** A missing route or account (404). */
	missing?: boolean;
	route?: "prelogin" | "keys";
	lookupError?: KeyFlowError;
	recorded?: boolean;
	hasError?: boolean;
	setError?: boolean;
	primitives?: Primitives;
};

function rig(over: Over = {}) {
	const lookup = vi.fn(async () => {
		if (over.lookupError) throw over.lookupError;
		if (over.missing) return { missing: true as const };
		if ("body" in over) return { body: over.body };
		return { body: { kdf: over.kdf === undefined ? KDF : over.kdf } };
	});
	const has = vi.fn(async () => {
		if (over.hasError) throw new Error("locked");
		return over.recorded === true;
	});
	const set = vi.fn(async () => {
		if (over.setError) throw new Error("full");
	});
	const paint = vi.fn(async () => {});
	const primitives = vi.fn(async () => over.primitives ?? p);
	const ports: FlowPorts = {
		primitives,
		paint,
		lookup,
		lookupRoute: over.route ?? "prelogin",
		record: { has, set },
	};
	return { ports, lookup, has, set, paint, primitives };
}

const codeOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e instanceof KeyFlowError ? e.code : `other:${String(e)}`;
	}
	return "none";
};

describe("signInSecretFor", () => {
	it("sends the typed password for an account the server says has no keys, and records nothing", async () => {
		const r = rig({ kdf: null });
		expect(await signInSecretFor(r.ports, TYPED)).toBe(TYPED);
		expect(r.primitives).not.toHaveBeenCalled();
		expect(r.set).not.toHaveBeenCalled();
	});

	it("derives the vector's sign-in secret for a keyed account, after a paint, and records it", async () => {
		const r = rig();
		const secret = await signInSecretFor(r.ports, MASTER.password);
		expect(secret).toBe(EXPECTED);
		expect(secret).not.toBe(MASTER.password);
		expect(r.paint).toHaveBeenCalledTimes(1);
		expect(r.set).toHaveBeenCalledTimes(1);
	});

	it("refuses parameters outside the floor and ceiling before the library loads or anything is derived", async () => {
		for (const bad of [
			{ ...KDF, memoryKiB: 1024 },
			{ ...KDF, passes: 0 },
			{ ...KDF, memoryKiB: 256 * 1024 + 1 },
			{ ...KDF, passes: 11 },
		]) {
			const r = rig({ kdf: bad });
			expect(await codeOf(signInSecretFor(r.ports, MASTER.password))).toBe(
				"params",
			);
			expect(r.primitives).not.toHaveBeenCalled();
			expect(r.paint).not.toHaveBeenCalled();
			expect(r.set).not.toHaveBeenCalled();
		}
	});

	it("refuses a salt that is not 16 bytes before the library loads", async () => {
		const r = rig({ kdf: { ...KDF, salt: "AAAA" } });
		expect(await codeOf(signInSecretFor(r.ports, MASTER.password))).toBe(
			"malformed",
		);
		expect(r.primitives).not.toHaveBeenCalled();
	});

	describe("the lookup answer", () => {
		const MALFORMED: [string, unknown][] = [
			["no body", null],
			["a string", "keys"],
			["an empty object", {}],
			["no kdf field", { version: 1 }],
			["a kdf that is a string", { kdf: "keys" }],
			["a kdf without a salt", { kdf: { memoryKiB: 65536, passes: 3 } }],
			["a salt that is not text", { kdf: { ...KDF, salt: 7 } }],
			["parameters that are not integers", { kdf: { ...KDF, passes: 1.5 } }],
			["parameters that are text", { kdf: { ...KDF, memoryKiB: "9" } }],
		];

		it("is unavailable, never no keys, when it is not the expected shape", async () => {
			for (const recorded of [false, true]) {
				for (const [, body] of MALFORMED) {
					const r = rig({ recorded, body });
					expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe(
						"unavailable",
					);
					expect(r.primitives).not.toHaveBeenCalled();
					expect(r.set).not.toHaveBeenCalled();
				}
			}
		});

		it("is unavailable for a null kdf from the keys route, which has no such answer", async () => {
			const r = rig({ route: "keys", kdf: null });
			expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe(
				"unavailable",
			);
			expect(await codeOf(accountIsKeyed(r.ports))).toBe("unavailable");
			expect(r.set).not.toHaveBeenCalled();
		});

		it("cannot tell whether the account is keyed from a malformed answer", async () => {
			for (const [, body] of MALFORMED) {
				const r = rig({ body });
				expect(await codeOf(accountIsKeyed(r.ports))).toBe("unavailable");
				expect(r.set).not.toHaveBeenCalled();
			}
		});

		it("takes a null kdf from prelogin and a missing route as no keys", async () => {
			expect(await signInSecretFor(rig({ kdf: null }).ports, TYPED)).toBe(
				TYPED,
			);
			expect(await signInSecretFor(rig({ missing: true }).ports, TYPED)).toBe(
				TYPED,
			);
			for (const route of ["prelogin", "keys"] as const) {
				expect(await accountIsKeyed(rig({ route, missing: true }).ports)).toBe(
					false,
				);
			}
		});
	});

	describe("for an account recorded as keyed", () => {
		it("refuses a null answer and never returns the typed password", async () => {
			const r = rig({ recorded: true, kdf: null });
			expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe("downgrade");
		});

		it("refuses a rate limit and an error with the code it got", async () => {
			for (const code of ["rateLimited", "unavailable"] as const) {
				const r = rig({ recorded: true, lookupError: new KeyFlowError(code) });
				expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe(code);
			}
		});

		it("still derives when the server answers keyed", async () => {
			const r = rig({ recorded: true });
			expect(await signInSecretFor(r.ports, MASTER.password)).toBe(EXPECTED);
		});
	});

	it("never falls back to the typed password on an error, recorded or not", async () => {
		const r = rig({ lookupError: new KeyFlowError("unavailable") });
		expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe("unavailable");
	});

	it("sends nothing when the record cannot be read, and does not ask the server", async () => {
		const r = rig({ hasError: true, kdf: null });
		expect(await codeOf(signInSecretFor(r.ports, TYPED))).toBe("unreadable");
		expect(r.lookup).not.toHaveBeenCalled();
	});

	it("sends nothing when the record cannot be written after a derive", async () => {
		const r = rig({ setError: true });
		expect(await codeOf(signInSecretFor(r.ports, MASTER.password))).toBe(
			"unreadable",
		);
	});

	it("has nothing to derive for an empty password and does not ask the server", async () => {
		const r = rig();
		expect(await signInSecretFor(r.ports, "")).toBe("");
		expect(r.lookup).not.toHaveBeenCalled();
	});
});

describe("deriveSignInSecret", () => {
	/** The 32-byte keys a derivation makes, watched. */
	function watched(shortAuthKey = false) {
		const kept: Uint8Array[] = [];
		let derives = 0;
		const q: Primitives = {
			...p,
			argon2id: (...a) => {
				const out = p.argon2id(...a);
				kept.push(out);
				return out;
			},
			kdfDerive: (...a) => {
				const full = p.kdfDerive(...a);
				// A 31-byte auth key: every key exists when the secret is refused.
				const out = shortAuthKey && ++derives === 1 ? full.slice(0, 31) : full;
				kept.push(out);
				return out;
			},
		};
		return { q, kept };
	}

	it("wipes the master key and both subkeys after a derive", async () => {
		const w = watched();
		const secret = await deriveSignInSecret(
			{ primitives: async () => w.q },
			MASTER.password,
			KDF,
		);
		expect(secret).toBe(EXPECTED);
		expect(w.kept).toHaveLength(3);
		expect(w.kept.every((b) => b.every((x) => x === 0))).toBe(true);
	});

	it("wipes what it made when a step fails part way", async () => {
		// The secret is refused for the short auth key, after all three keys exist.
		const w = watched(true);
		expect(
			await codeOf(
				deriveSignInSecret(
					{ primitives: async () => w.q },
					MASTER.password,
					KDF,
				),
			),
		).toBe("malformed");
		expect(w.kept).toHaveLength(3);
		expect(w.kept.every((b) => b.every((x) => x === 0))).toBe(true);
	});
});

describe("accountIsKeyed", () => {
	it("is true from the record without asking the server, even when the server now says no keys", async () => {
		const r = rig({ recorded: true, kdf: null });
		expect(await accountIsKeyed(r.ports)).toBe(true);
		expect(r.lookup).not.toHaveBeenCalled();
	});

	it("is true and recorded when the server says keyed, false for no keys", async () => {
		const keyed = rig();
		expect(await accountIsKeyed(keyed.ports)).toBe(true);
		expect(keyed.set).toHaveBeenCalledTimes(1);
		const none = rig({ kdf: null });
		expect(await accountIsKeyed(none.ports)).toBe(false);
		expect(none.set).not.toHaveBeenCalled();
	});

	it("cannot tell when the server cannot be asked or the record cannot be read", async () => {
		expect(
			await codeOf(
				accountIsKeyed(
					rig({ lookupError: new KeyFlowError("rateLimited") }).ports,
				),
			),
		).toBe("rateLimited");
		expect(await codeOf(accountIsKeyed(rig({ hasError: true }).ports))).toBe(
			"unreadable",
		);
	});
});
