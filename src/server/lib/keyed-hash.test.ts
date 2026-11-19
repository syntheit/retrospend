import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ BETTER_AUTH_SECRET: "secret-one" }));
vi.mock("~/env", () => ({ env }));

const hmac = (key: string | Buffer, value: string) =>
	createHmac("sha256", key).update(value).digest();

beforeEach(() => {
	vi.resetModules();
	env.BETTER_AUTH_SECRET = "secret-one";
});

describe("keyedHash", () => {
	it("is the HMAC under a key derived from the secret with the purpose's label", async () => {
		const { keyedHash, KEYED_HASH_PURPOSES } = await import("./keyed-hash");
		for (const [purpose, label] of Object.entries(KEYED_HASH_PURPOSES)) {
			const derived = hmac("secret-one", label);
			expect(
				keyedHash(purpose as keyof typeof KEYED_HASH_PURPOSES, "a@b.c"),
			).toBe(hmac(derived, "a@b.c").toString("hex"));
		}
	});

	it("is not the plain hash of the value, nor an HMAC under the secret itself", async () => {
		const { keyedHash } = await import("./keyed-hash");
		const out = keyedHash("resetAddress", "a@b.c");
		expect(out).not.toBe(createHash("sha256").update("a@b.c").digest("hex"));
		expect(out).not.toBe(hmac("secret-one", "a@b.c").toString("hex"));
	});

	it("gives each purpose its own hash for the same value", async () => {
		const { keyedHash, KEYED_HASH_PURPOSES } = await import("./keyed-hash");
		const purposes = Object.keys(
			KEYED_HASH_PURPOSES,
		) as (keyof typeof KEYED_HASH_PURPOSES)[];
		const hashes = purposes.map((p) => keyedHash(p, "a@b.c"));
		expect(new Set(hashes).size).toBe(purposes.length);
		expect(new Set(Object.values(KEYED_HASH_PURPOSES)).size).toBe(
			purposes.length,
		);
	});

	it("changes with the secret, so a copy of the table is no use without it", async () => {
		const first = (await import("./keyed-hash")).keyedHash(
			"preloginAddress",
			"a@b.c",
		);
		vi.resetModules();
		env.BETTER_AUTH_SECRET = "secret-two";
		const second = (await import("./keyed-hash")).keyedHash(
			"preloginAddress",
			"a@b.c",
		);
		expect(second).not.toBe(first);
	});
});
