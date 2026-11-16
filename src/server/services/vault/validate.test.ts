// The validation against real records made by @retrospend/crypto, so a change
// to the record format there (header, bucket size, limits) fails here before
// it fails in production, and the server's idea of a valid record cannot drift
// from the client's. Every refusal has an accepted twin that differs in the
// one thing under test.
import { MAX_PLAINTEXT_BYTES } from "@retrospend/crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { VaultError } from "./errors";
import {
	isSealedShape,
	MAX_BATCH_BYTES,
	MAX_WRITES,
	type VaultWrite,
	validateVaultWrites,
} from "./validate";
import { contextOf, type Sealer, sealer, writeOf } from "./vault-test-support";

const USER = "user_1";
let seal: Sealer;
beforeAll(async () => {
	seal = await sealer();
});

const code = (run: () => void) => {
	try {
		run();
	} catch (error) {
		return error instanceof VaultError ? error.code : error;
	}
	return "ok";
};
const one = (over: Partial<VaultWrite> = {}): VaultWrite => ({
	...writeOf(seal, USER, "rec1", 0),
	...over,
});
/** A buffer of `bytes` bytes that starts like a sealed record. */
const shaped = (bytes: number) => {
	const out = new Uint8Array(bytes);
	out[0] = 1;
	out[1] = 1;
	return out;
};

describe("the sealed shape", () => {
	it("accepts what sealRecord makes, whatever its size", () => {
		expect(isSealedShape(seal(contextOf(USER, "r", 0)))).toBe(true);
		const big = seal(contextOf(USER, "r", 0), { note: "x".repeat(5000) });
		expect(big.length).toBeGreaterThan(5000);
		expect(isSealedShape(big)).toBe(true);
	});

	it("pins the sizes: 122 up to 58 + 1 MiB in 64-byte steps", () => {
		expect(isSealedShape(shaped(122))).toBe(true);
		expect(isSealedShape(shaped(121))).toBe(false);
		expect(isSealedShape(shaped(58))).toBe(false);
		expect(isSealedShape(shaped(123))).toBe(false);
		expect(isSealedShape(shaped(58 + MAX_PLAINTEXT_BYTES))).toBe(true);
		expect(isSealedShape(shaped(58 + MAX_PLAINTEXT_BYTES + 64))).toBe(false);
	});

	it("pins the header: version 1 and algorithm 1", () => {
		const good = shaped(122);
		expect(isSealedShape(good)).toBe(true);
		for (const [a, b] of [
			[0, 1],
			[2, 1],
			[1, 0],
			[1, 2],
		] as const) {
			const bytes = shaped(122);
			bytes[0] = a;
			bytes[1] = b;
			expect(isSealedShape(bytes), `${a} ${b}`).toBe(false);
		}
	});
});

describe("validateVaultWrites", () => {
	it("accepts creates, updates and tombstones, and an empty batch", () => {
		expect(code(() => validateVaultWrites([]))).toBe("ok");
		expect(
			code(() =>
				validateVaultWrites([
					one({ id: "a" }),
					writeOf(seal, USER, "b", 3),
					writeOf(seal, USER, "c", 1, { tombstone: true }),
				]),
			),
		).toBe("ok");
	});

	it("refuses a bad id, collection, entity or base version", () => {
		const cases: [string, Partial<VaultWrite>][] = [
			["empty id", { id: "" }],
			["id over 64", { id: "a".repeat(65) }],
			["id with a pipe", { id: "a|b" }],
			["empty collection", { collectionId: "" }],
			["collection with a slash", { collectionId: "a/b" }],
			["entity 0", { entity: 0 }],
			["entity over 65535", { entity: 65536 }],
			["fractional entity", { entity: 1.5 }],
			["negative base", { baseVersion: -1 }],
			["fractional base", { baseVersion: 0.5 }],
			["base past the column", { baseVersion: 2 ** 31 - 1 }],
			["short bytes", { ciphertext: shaped(100) }],
			["empty bytes", { ciphertext: new Uint8Array(0) }],
		];
		for (const [label, over] of cases) {
			expect(
				code(() => validateVaultWrites([one(over)])),
				label,
			).toBe("invalid_input");
		}
		// The twins at the limits.
		for (const over of [
			{ id: "a".repeat(64) },
			{ entity: 1 },
			{ entity: 40000 },
			{ entity: 65535 },
			{ baseVersion: 2 ** 31 - 2 },
		] as Partial<VaultWrite>[]) {
			expect(code(() => validateVaultWrites([one(over)]))).toBe("ok");
		}
	});

	it("refuses a tombstone that creates, and the same id twice", () => {
		expect(code(() => validateVaultWrites([one({ ciphertext: null })]))).toBe(
			"invalid_input",
		);
		expect(
			code(() =>
				validateVaultWrites([
					one({ id: "a" }),
					one({ id: "b" }),
					one({ id: "a" }),
				]),
			),
		).toBe("invalid_input");
	});

	it("caps the batch at 500 writes", () => {
		const many = (n: number) =>
			Array.from({ length: n }, (_, i) => one({ id: `r${i}` }));
		expect(code(() => validateVaultWrites(many(MAX_WRITES)))).toBe("ok");
		expect(code(() => validateVaultWrites(many(MAX_WRITES + 1)))).toBe(
			"invalid_input",
		);
	});

	it("caps the ciphertext of a batch at 8 MiB, exactly", () => {
		// 8 MiB is 32 records of 58 bytes each plus 131043 buckets of 64.
		const sizes = [...Array.from({ length: 31 }, () => 58 + 4095 * 64), 0];
		sizes[31] = MAX_BATCH_BYTES - sizes.reduce((a, b) => a + b, 0);
		expect(sizes.reduce((a, b) => a + b, 0)).toBe(MAX_BATCH_BYTES);
		const batch = (last: number) =>
			sizes.map((size, i) =>
				one({ id: `r${i}`, ciphertext: shaped(i === 31 ? last : size) }),
			);
		expect(code(() => validateVaultWrites(batch(sizes[31] as number)))).toBe(
			"ok",
		);
		expect(
			code(() => validateVaultWrites(batch((sizes[31] as number) + 64))),
		).toBe("invalid_input");
	});
});
