import { toBase64Url } from "@retrospend/crypto";
import { describe, expect, it, vi } from "vitest";
import vectors from "../../../packages/crypto/vectors/keys.vectors.json";
import {
	forgetKeyed,
	SignInSecretError,
	signInSecretFor,
} from "./sign-in-secret";

// The second master vector uses the floor parameters, so a derivation takes
// a fraction of the default one. Its auth key is a known answer from a
// generator that shares no code with the app (packages/crypto/scripts).
const MASTER = vectors.masters[1];
if (!MASTER) throw new Error("vector missing");
const FLOOR_ONLY = {
	salt: toBase64Url(Uint8Array.from(Buffer.from(MASTER.salt, "hex"))),
	memoryKiB: MASTER.memoryKiB,
	passes: MASTER.passes,
};
const EXPECTED = toBase64Url(
	Uint8Array.from(Buffer.from(MASTER.authKey, "hex")),
);
const EMAIL = "Person@Example.com";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

function memoryStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
	};
}

function setup(answer: () => Response | Promise<Response>) {
	const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) =>
		answer(),
	);
	const storage = memoryStorage();
	const paint = vi.fn(async () => {});
	return {
		fetch,
		storage,
		paint,
		run: (
			password: string,
			options: { signedIn?: boolean; email?: string } = {},
		) =>
			signInSecretFor(options.email ?? EMAIL, password, {
				signedIn: options.signedIn,
				deps: { fetch: fetch as typeof globalThis.fetch, storage, paint },
			}),
	};
}

const failure = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		return e instanceof SignInSecretError ? e.code : "other";
	}
	return "none";
};

describe("signInSecretFor", () => {
	it("sends the typed password for an account without keys", async () => {
		const t = setup(() => json({ kdf: null }));
		expect(await t.run("Plain-pw-1")).toBe("Plain-pw-1");
		expect(t.paint).not.toHaveBeenCalled();
		// The address goes lowercased in the body; the call is the public prelogin.
		const [url, init] = t.fetch.mock.calls[0] ?? [];
		expect(url).toBe("/api/v1/auth/prelogin");
		expect(JSON.parse(String(init?.body))).toEqual({
			email: "person@example.com",
		});
		expect(t.storage.map.size).toBe(0);
	});

	it("sends the vector's sign-in secret for a keyed account, after a paint", async () => {
		const t = setup(() => json({ kdf: FLOOR_ONLY }));
		const secret = await t.run(MASTER.password);
		expect(secret).toBe(EXPECTED);
		expect(secret).not.toBe(MASTER.password);
		expect(t.paint).toHaveBeenCalledTimes(1);
	});

	it("takes the parameters from the keys route when signed in", async () => {
		const t = setup(() =>
			json({
				createdAt: "2026-11-16T00:00:00.000Z",
				version: 1,
				kdf: FLOOR_ONLY,
			}),
		);
		expect(await t.run(MASTER.password, { signedIn: true })).toBe(EXPECTED);
		expect(t.fetch.mock.calls[0]?.[0]).toBe("/api/v1/me/protection/keys");
	});

	it("sends the typed password when the keys route says there are none", async () => {
		const t = setup(() => json({ title: "Not found" }, 404));
		expect(await t.run("Plain-pw-1", { signedIn: true })).toBe("Plain-pw-1");
	});

	it("refuses parameters below the floor or above the ceiling before any derivation", async () => {
		for (const bad of [
			{ ...FLOOR_ONLY, memoryKiB: 1024 },
			{ ...FLOOR_ONLY, passes: 0 },
			{ ...FLOOR_ONLY, memoryKiB: 256 * 1024 + 1 },
			{ ...FLOOR_ONLY, passes: 11 },
		]) {
			const t = setup(() => json({ kdf: bad }));
			expect(await failure(t.run(MASTER.password))).toBe("params");
			expect(t.paint).not.toHaveBeenCalled();
		}
	});

	it("refuses a salt that is not 16 bytes", async () => {
		const t = setup(() => json({ kdf: { ...FLOOR_ONLY, salt: "AAAA" } }));
		expect(await failure(t.run(MASTER.password))).toBe("unavailable");
	});

	it("refuses a null answer for an address it saw keyed", async () => {
		let keyed = true;
		const t = setup(() => json({ kdf: keyed ? FLOOR_ONLY : null }));
		await t.run(MASTER.password);
		keyed = false;
		expect(await failure(t.run(MASTER.password))).toBe("downgrade");
		// The same address in another case is the same account.
		expect(
			await failure(t.run(MASTER.password, { email: "  person@example.COM " })),
		).toBe("downgrade");
		// Another address is unaffected.
		expect(await t.run("pw", { email: "other@example.com" })).toBe("pw");
	});

	it("refuses a network error and a server error for a recorded address", async () => {
		let mode: "keyed" | "network" | "500" | "404" = "keyed";
		const t = setup(() => {
			if (mode === "keyed") return json({ kdf: FLOOR_ONLY });
			if (mode === "network") throw new TypeError("offline");
			if (mode === "404") return json({}, 404);
			return json({}, 500);
		});
		await t.run(MASTER.password);
		mode = "network";
		expect(await failure(t.run(MASTER.password))).toBe("unavailable");
		mode = "500";
		expect(await failure(t.run(MASTER.password))).toBe("unavailable");
		mode = "404";
		expect(await failure(t.run(MASTER.password))).toBe("downgrade");
	});

	it("falls back to the typed password only for an unrecorded address on a server with no prelogin route", async () => {
		const t = setup(() => json({}, 404));
		expect(await t.run("Plain-pw-1")).toBe("Plain-pw-1");
	});

	it("never falls back on an error, even for an unrecorded address", async () => {
		const t = setup(() => json({}, 500));
		expect(await failure(t.run("Plain-pw-1"))).toBe("unavailable");
		const malformed = setup(() => json({ kdf: { salt: 1 } }));
		expect(await failure(malformed.run("Plain-pw-1"))).toBe("unavailable");
	});

	it("signs in with the typed password again once the address is forgotten", async () => {
		let keyed = true;
		const t = setup(() => json({ kdf: keyed ? FLOOR_ONLY : null }));
		await t.run(MASTER.password);
		keyed = false;
		expect(await failure(t.run("New-pw-1"))).toBe("downgrade");
		await forgetKeyed(EMAIL, { storage: t.storage });
		expect(t.storage.map.size).toBe(0);
		expect(await t.run("New-pw-1")).toBe("New-pw-1");
	});

	it("forgets only the address it is given", async () => {
		const t = setup(() => json({ kdf: FLOOR_ONLY }));
		await t.run(MASTER.password);
		await t.run(MASTER.password, { email: "other@example.com" });
		await forgetKeyed("PERSON@example.com ", { storage: t.storage });
		expect(t.storage.map.size).toBe(1);
	});

	it("keeps the address out of storage", async () => {
		const t = setup(() => json({ kdf: FLOOR_ONLY }));
		await t.run(MASTER.password);
		const [key, value] = [...t.storage.map][0] ?? [];
		expect(key).toMatch(/^rs\.keyed\.[0-9a-f]{64}$/);
		expect(value).toBe("1");
		expect(JSON.stringify([...t.storage.map])).not.toMatch(/person|example/i);
	});

	it("still derives when storage is blocked", async () => {
		const fetch = vi.fn(async () => json({ kdf: FLOOR_ONLY }));
		const secret = await signInSecretFor(EMAIL, MASTER.password, {
			deps: {
				fetch: fetch as typeof globalThis.fetch,
				storage: {
					removeItem: () => {
						throw new Error("blocked");
					},
					getItem: () => {
						throw new Error("blocked");
					},
					setItem: () => {
						throw new Error("blocked");
					},
				},
				paint: async () => {},
			},
		});
		expect(secret).toBe(EXPECTED);
	});
});
