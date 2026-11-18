// The rules @retrospend/crypto owns, checked against every place that has to
// write them as text because it cannot import the package: the API contract
// (zod schemas shared with the phone), a server path guard and the SQL CHECKs.
// The test reads the source, so a changed pattern in any of them fails here and
// not in production.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enableWrapSchema } from "@retrospend/api-contract";
import {
	ID_PATTERN,
	KEY_ID_HEX_PATTERN,
	PUBLIC_WRAP_BYTES,
	SYMMETRIC_WRAP_BYTES,
} from "@retrospend/crypto";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(resolve(process.cwd(), path), "utf8");
/** How many times `text` writes the regex literal `/<source>/`. */
const count = (text: string, source: string) =>
	text.split(`/${source}/`).length - 1;
const sqlCount = (text: string, source: string) =>
	text.split(`'${source}'`).length - 1;

describe("the id pattern, written outside the crypto package", () => {
	it("is the same text in the contract, the export path guard and the SQL CHECKs", () => {
		const id = ID_PATTERN.source;
		// protection wrap targetId; vault record and collection ids
		expect(count(read("packages/api-contract/src/keys/index.ts"), id)).toBe(1);
		expect(count(read("packages/api-contract/src/vault/index.ts"), id)).toBe(1);
		// the user id (an AAD id) that names an export folder
		expect(count(read("src/server/export-storage.ts"), id)).toBe(1);
		expect(
			sqlCount(
				read("prisma/migrations/20261115200000_protection_keys/migration.sql"),
				id,
			),
		).toBe(1);
		expect(
			sqlCount(
				read("prisma/migrations/20261116100000_vault_record/migration.sql"),
				id,
			),
		).toBe(2);
	});

	it("the collection key id pattern is the same text in the contract", () => {
		expect(
			count(
				read("packages/api-contract/src/keys/index.ts"),
				KEY_ID_HEX_PATTERN.source,
			),
		).toBe(1);
	});
});

describe("the key text patterns in the API contract", () => {
	it("are written once, in the keys file", () => {
		const root = resolve(process.cwd(), "packages/api-contract/src");
		const all = readdirSync(root, { recursive: true, encoding: "utf8" });
		const files = all.filter(
			(f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
		);
		const keys = "keys/index.ts";
		expect(files).toContain(keys);
		const copies = files.filter(
			(f) =>
				f !== keys &&
				/\{43\}|\{1,512\}|\[0-9a-f\]\{32\}|\{22\}/.test(
					read(`packages/api-contract/src/${f}`),
				),
		);
		expect(copies).toEqual([]);
	});

	it("pins the key and wrap shapes the server writes bytes from", () => {
		const text = read("packages/api-contract/src/keys/index.ts");
		expect(count(text, "^[A-Za-z0-9_-]{43}$")).toBe(1);
		expect(count(text, "^[A-Za-z0-9_-]{1,512}$")).toBe(1);
	});
});

describe("the wrap sizes, written in the key-set migration", () => {
	it("are the sizes the crypto package makes", () => {
		const sql = read(
			"prisma/migrations/20261115200000_protection_keys/migration.sql",
		);
		expect(sql).toContain(`octet_length("wrapped") = ${SYMMETRIC_WRAP_BYTES}`);
		expect(sql).toContain(`octet_length("wrapped") = ${PUBLIC_WRAP_BYTES}`);
	});
});

describe("the contract's collection key target", () => {
	const wrap = (role: string, targetId: string) =>
		enableWrapSchema.safeParse({ role, targetId, wrapped: "A".repeat(100) })
			.success;
	const hex = "00ff00ff00ff00ff00ff00ff00ff00ff";

	it("takes only the lowercase hex of the key id for a collection key", () => {
		expect(wrap("collection-key", hex)).toBe(true);
		expect(wrap("collection-key", hex.toUpperCase())).toBe(false);
		expect(wrap("collection-key", "AP8A_wD_AP8A_wD_AP8A_w")).toBe(false);
		expect(wrap("collection-key", "k1")).toBe(false);
	});

	it("keeps the general id rule for the other roles", () => {
		expect(wrap("private-key", "user_1")).toBe(true);
		expect(wrap("private-key", "has space")).toBe(false);
	});
});
