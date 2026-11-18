// The recovery proof's hash and compare (validate.ts): the server keeps the
// SHA-256 of the 32-byte recovery auth key, never the key, and compares in
// constant time. Expected hashes are the F3 vectors, made by gen-keys.mjs with
// its own SHA-256, not by this code.
import { createHash } from "node:crypto";
import { toBase64Url } from "@retrospend/crypto";
import { describe, expect, it, vi } from "vitest";
import vectors from "../../../../packages/crypto/vectors/keys.vectors.json";
import { ProtectionKeysError } from "./errors";
import {
	hashRecoveryProof,
	RECOVERY_HASH_BYTES,
	recoveryProofMatches,
} from "./validate";

const compare = vi.hoisted(() => ({ calls: [] as [Uint8Array, Uint8Array][] }));
vi.mock("node:crypto", async (original) => {
	const actual = await original<typeof import("node:crypto")>();
	return {
		...actual,
		timingSafeEqual: (a: Uint8Array, b: Uint8Array) => {
			compare.calls.push([a, b]);
			return actual.timingSafeEqual(a, b);
		},
	};
});

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const proofText = (authKeyHex: string) =>
	toBase64Url(Uint8Array.from(Buffer.from(authKeyHex, "hex")));

describe("hashRecoveryProof", () => {
	it("is the SHA-256 of the 32 raw bytes, for every vector, and not the proof", () => {
		for (const v of vectors.recoveryKeys) {
			const hash = hashRecoveryProof(proofText(v.authKey));
			expect(hash.length, v.name).toBe(RECOVERY_HASH_BYTES);
			expect(hex(hash), v.name).toBe(v.authKeyHash);
			expect(hex(hash), v.name).not.toBe(v.authKey);
		}
		// The text is not what is hashed: its own SHA-256 is another value.
		const v = vectors.recoveryKeys[0];
		if (!v) throw new Error("no vector");
		const ofText = createHash("sha256")
			.update(proofText(v.authKey))
			.digest("hex");
		expect(hex(hashRecoveryProof(proofText(v.authKey)))).not.toBe(ofText);
	});

	it("refuses text that is not 32 bytes of canonical base64url", () => {
		const v = vectors.recoveryKeys[1];
		if (!v) throw new Error("no vector");
		const good = proofText(v.authKey);
		for (const bad of [
			"",
			good.slice(1),
			`${good}A`,
			`${good.slice(0, -1)}9`,
			`${good.slice(0, 42)}+`,
			toBase64Url(new Uint8Array(31)),
			toBase64Url(new Uint8Array(33)),
		]) {
			expect(() => hashRecoveryProof(bad), bad).toThrow(ProtectionKeysError);
		}
	});
});

describe("recoveryProofMatches", () => {
	const v = vectors.recoveryKeys[2];
	const other = vectors.recoveryKeys[3];
	if (!v || !other) throw new Error("no vectors");
	const stored = Uint8Array.from(Buffer.from(v.authKeyHash, "hex"));

	it("accepts the proof the hash was made from and no other", () => {
		expect(recoveryProofMatches(stored, proofText(v.authKey))).toBe(true);
		expect(recoveryProofMatches(stored, proofText(other.authKey))).toBe(false);
		// The hash itself is not a proof of anything.
		expect(recoveryProofMatches(stored, toBase64Url(stored))).toBe(false);
	});

	it("matches nothing without a stored hash, or with a malformed one or proof", () => {
		const proof = proofText(v.authKey);
		expect(recoveryProofMatches(null, proof)).toBe(false);
		expect(recoveryProofMatches(undefined, proof)).toBe(false);
		expect(recoveryProofMatches(new Uint8Array(0), proof)).toBe(false);
		expect(recoveryProofMatches(stored.slice(1), proof)).toBe(false);
		expect(recoveryProofMatches(stored, "")).toBe(false);
		expect(recoveryProofMatches(stored, "not a proof")).toBe(false);
	});

	it("compares the two hashes with timingSafeEqual", () => {
		compare.calls.length = 0;
		recoveryProofMatches(stored, proofText(other.authKey));
		expect(compare.calls).toHaveLength(1);
		expect(hex(compare.calls[0]?.[0] ?? new Uint8Array())).toBe(
			other.authKeyHash,
		);
		expect(hex(compare.calls[0]?.[1] ?? new Uint8Array())).toBe(v.authKeyHash);
	});
});
