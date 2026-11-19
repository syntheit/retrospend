import { fromHex, toHex } from "@retrospend/crypto";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { describe, expect, it } from "vitest";
import { digestOfRecoveryWrap, lazyOnce } from "./recovery-digest";

describe("lazyOnce", () => {
	it("loads once and shares the result", async () => {
		let calls = 0;
		const get = lazyOnce(async () => ++calls);
		expect(await Promise.all([get(), get()])).toEqual([1, 1]);
		expect(await get()).toBe(1);
		expect(calls).toBe(1);
	});

	it("forgets a failed load, so a transient failure is not permanent", async () => {
		let calls = 0;
		const get = lazyOnce(async () => {
			calls += 1;
			if (calls === 1) throw new Error("wasm not ready");
			return calls;
		});
		await expect(get()).rejects.toThrow("wasm not ready");
		expect(await get()).toBe(2);
		expect(await get()).toBe(2);
	});
});

describe("digestOfRecoveryWrap", () => {
	it("is the vector digest of the wrap", async () => {
		const v = vectors.symmetricWraps.find((w) => w.role === "ak-recovery");
		if (!v) throw new Error("vector missing");
		expect(toHex(await digestOfRecoveryWrap(fromHex(v.wrapped)))).toBe(
			v.digest,
		);
	});
});
