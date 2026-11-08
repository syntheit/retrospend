// The owner role's password is derived from the superuser's, so no new secret
// has to be configured. The derivation must give the same value in Node (here)
// and in Go (the sidecar, A2 PR 2), so the vectors live in a JSON file both
// read. Their expected values were made with Python's hmac, not with this code.
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	deriveOwnerPassword,
	ownerUrl,
	scramVerifier,
	urlPassword,
} from "../../../scripts/db-owner/index.mjs";
import vectors from "../../../scripts/db-owner/vectors.json";

describe("deriveOwnerPassword", () => {
	for (const c of vectors.cases) {
		it(`matches the shared vector: ${c.name}`, () => {
			const password = urlPassword(c.url);
			expect(password).toBe(c.password);
			expect(deriveOwnerPassword(password ?? "")).toBe(c.ownerPassword);
		});
	}

	it("keys on the percent-decoded password, not on its URL spelling", () => {
		const encoded = vectors.cases[1];
		if (!encoded) throw new Error("vector missing");
		expect(deriveOwnerPassword(encodeURIComponent(encoded.password))).not.toBe(
			encoded.ownerPassword,
		);
	});

	it("is the HMAC of the role name, so it is one-way and 64 hex characters", () => {
		const out = deriveOwnerPassword("secret");
		expect(out).toMatch(/^[0-9a-f]{64}$/);
		expect(out).toBe(
			createHmac("sha256", "secret").update("retrospend_owner").digest("hex"),
		);
		expect(out).not.toContain("secret");
	});
});

describe("urlPassword", () => {
	it("returns null when there is no password or the URL does not parse", () => {
		expect(urlPassword("postgresql://postgres@localhost/db")).toBeNull();
		expect(urlPassword("not a url")).toBeNull();
	});

	it("returns null for a password that is not valid percent-encoding", () => {
		expect(urlPassword("postgresql://postgres:abc%zz@localhost/db")).toBeNull();
	});
});

describe("ownerUrl", () => {
	it("keeps host, database and query, and replaces the user and password", () => {
		const url = new URL(
			ownerUrl(
				"postgresql://postgres:p%40ss@db.internal:5433/retro?sslmode=disable",
				"abc123",
			),
		);
		expect(url.username).toBe("retrospend_owner");
		expect(url.password).toBe("abc123");
		expect(url.hostname).toBe("db.internal");
		expect(url.port).toBe("5433");
		expect(url.pathname).toBe("/retro");
		expect(url.searchParams.get("sslmode")).toBe("disable");
		expect(ownerUrl("postgresql://postgres:x@h/db", "abc")).not.toContain(
			"postgres:",
		);
	});
});

describe("scramVerifier", () => {
	it("is a SCRAM-SHA-256 verifier the server can check the password against", () => {
		const salt = Buffer.from("0123456789abcdef");
		const verifier = scramVerifier("hunter2", salt, 4096);
		const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
		expect(match).not.toBeNull();
		const [, iterations, saltB64, stored, server] = match ?? [];
		expect(Number(iterations)).toBe(4096);
		expect(saltB64).toBe(salt.toString("base64"));
		// RFC 5802: StoredKey = H(HMAC(SaltedPassword, "Client Key")),
		// ServerKey = HMAC(SaltedPassword, "Server Key").
		const salted = pbkdf2Sync("hunter2", salt, 4096, 32, "sha256");
		const clientKey = createHmac("sha256", salted)
			.update("Client Key")
			.digest();
		expect(stored).toBe(
			createHash("sha256").update(clientKey).digest("base64"),
		);
		expect(server).toBe(
			createHmac("sha256", salted).update("Server Key").digest("base64"),
		);
		expect(verifier).not.toContain("hunter2");
	});

	it("uses a fresh random salt each time", () => {
		expect(scramVerifier("same")).not.toBe(scramVerifier("same"));
	});

	it("refuses fewer than 4096 iterations and passwords SASLprep would change", () => {
		expect(() => scramVerifier("pw", Buffer.alloc(16), 4095)).toThrow(/4096/);
		expect(() => scramVerifier("pässword")).toThrow(/ASCII/);
		expect(() => scramVerifier("with space")).toThrow(/ASCII/);
	});
});
