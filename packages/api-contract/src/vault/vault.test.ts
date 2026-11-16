import { describe, expect, it } from "vitest";
import { PROBLEM_STATUS, problemSchema } from "../common/errors";
import { EVENT_TYPES } from "../common/events";
import { isScope, isSessionScope, parseScopeList } from "../common/scopes";
import {
	VAULT_MAX_CIPHERTEXT_CHARS,
	VAULT_MAX_RECORD_BYTES,
	vaultChangesQuerySchema,
	vaultContract,
	vaultWriteSchema,
	vaultWritesSchema,
} from "./index";

const write = {
	id: "rec-1",
	collectionId: "col_1",
	entity: 40,
	baseVersion: 0,
	ciphertext: "AQE",
};

describe("vault contract", () => {
	it("scopes both routes to the vault session scope, and registers its event", () => {
		expect(isSessionScope("vault")).toBe(true);
		expect(isScope("vault")).toBe(false);
		expect(parseScopeList("read vault").unknown).toEqual(["vault"]);
		for (const route of Object.values(vaultContract))
			expect(route["~orpc"].meta.scope).toBe("vault");
		expect(vaultContract.writes["~orpc"].meta.event).toBe("vault.changed");
		expect(EVENT_TYPES).toContain("vault.changed");
	});

	it("maps the missing key set to its own 409 code", () => {
		expect(PROBLEM_STATUS.protection_keys_missing).toBe(409);
	});

	it("carries the conflicting ids in a problem", () => {
		const parsed = problemSchema.parse({
			type: "urn:retrospend:problem:conflict",
			title: "Conflict",
			status: 409,
			code: "conflict",
			conflictIds: ["a", "b"],
		});
		expect(parsed.conflictIds).toEqual(["a", "b"]);
		expect(() =>
			problemSchema.parse({ ...parsed, conflictIds: Array(501).fill("a") }),
		).toThrow();
	});

	it("takes base64url ciphertext, strictly, or null for a tombstone", () => {
		expect(vaultWriteSchema.safeParse(write).success).toBe(true);
		expect(
			vaultWriteSchema.safeParse({ ...write, baseVersion: 1, ciphertext: null })
				.success,
		).toBe(true);
		for (const bad of [
			"",
			"AAAAA", // 5 characters: one stray character cannot be base64
			"AA==", // padding
			"A A",
			"a+b/",
			"aéb",
			"A".repeat(VAULT_MAX_CIPHERTEXT_CHARS + 1),
		])
			expect(
				vaultWriteSchema.safeParse({ ...write, ciphertext: bad }).success,
				bad.slice(0, 8),
			).toBe(false);
		expect(
			vaultWriteSchema.safeParse({
				...write,
				ciphertext: "A".repeat(VAULT_MAX_CIPHERTEXT_CHARS),
			}).success,
		).toBe(true);
	});

	it("derives the text cap from the record cap", () => {
		expect(VAULT_MAX_RECORD_BYTES).toBe(58 + 1024 * 1024);
		expect(VAULT_MAX_CIPHERTEXT_CHARS).toBe(1_398_179);
	});

	it("refuses bad ids, entities, versions and batch sizes", () => {
		const bad = [
			{ ...write, id: "" },
			{ ...write, id: "x".repeat(65) },
			{ ...write, collectionId: "a b" },
			{ ...write, entity: 0 },
			{ ...write, entity: 65536 },
			{ ...write, baseVersion: -1 },
			{ ...write, baseVersion: 1.5 },
			{ ...write, baseVersion: 2 ** 31 - 1 },
		];
		for (const w of bad)
			expect(vaultWriteSchema.safeParse(w).success, JSON.stringify(w)).toBe(
				false,
			);
		expect(vaultWritesSchema.safeParse({ writes: [] }).success).toBe(false);
		expect(
			vaultWritesSchema.safeParse({ writes: Array(500).fill(write) }).success,
		).toBe(true);
		expect(
			vaultWritesSchema.safeParse({ writes: Array(501).fill(write) }).success,
		).toBe(false);
	});

	it("defaults the page to 500 and caps it at 1000", () => {
		expect(vaultChangesQuerySchema.parse({}).limit).toBe(500);
		expect(vaultChangesQuerySchema.parse({ limit: "1000" }).limit).toBe(1000);
		expect(vaultChangesQuerySchema.safeParse({ limit: "1001" }).success).toBe(
			false,
		);
		expect(vaultChangesQuerySchema.safeParse({ limit: "0" }).success).toBe(
			false,
		);
	});
});
