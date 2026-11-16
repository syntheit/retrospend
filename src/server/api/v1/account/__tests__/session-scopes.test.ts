import { parseScopeList } from "@retrospend/api-contract/common";
import { describe, expect, it } from "vitest";
import { mayCall, sessionScopesOf } from "../../scopes";

const held = ["account:delete", "account:security"];

describe("sessionScopesOf", () => {
	it("gives account deletion and security to the web app and the Expo app only", () => {
		expect(sessionScopesOf({ kind: "web", granted: null })).toEqual([
			...held,
			"vault",
		]);
		expect(sessionScopesOf({ kind: "mobile", granted: null })).toEqual([]);
		expect(
			sessionScopesOf({ kind: "mobile", granted: ["write:settings"] }),
		).toEqual(held);
		expect(
			sessionScopesOf({ kind: "mobile", granted: ["read", "write:settings"] }),
		).toEqual([...held, "sync"]);
	});

	it("gives sync to a mobile session with read stored, and to nothing else", () => {
		expect(sessionScopesOf({ kind: "mobile", granted: ["read"] })).toEqual([
			"sync",
		]);
		expect(
			sessionScopesOf({ kind: "mobile", granted: ["write:expenses"] }),
		).toEqual([]);
		expect(sessionScopesOf({ kind: "web", granted: null })).not.toContain(
			"sync",
		);
		for (const kind of ["device", "apiKey"] as const) {
			expect(
				sessionScopesOf({ kind, granted: ["read", "write:settings"] }),
			).not.toContain("sync");
		}
	});

	it("never gives it to a device session or an API key, whatever they store", () => {
		for (const kind of ["device", "apiKey"] as const) {
			expect(
				sessionScopesOf({
					kind,
					granted: ["read", "write:settings", "write:money"],
				}),
			).toEqual([]);
		}
	});
});

describe("sessionScopesOf and the vault scope", () => {
	const needs = ["read", "write:expenses", "write:money"] as const;

	it("gives it to every web session", () => {
		expect(sessionScopesOf({ kind: "web", granted: null })).toContain("vault");
	});

	it("gives a mobile session it only with read, write:expenses and write:money stored", () => {
		expect(sessionScopesOf({ kind: "mobile", granted: [...needs] })).toEqual([
			"sync",
			"vault",
		]);
		expect(
			sessionScopesOf({
				kind: "mobile",
				granted: [...needs, "write:settings", "admin"],
			}),
		).toEqual([...held, "sync", "vault"]);
		// Each missing scope alone takes it away.
		for (const missing of needs) {
			const granted = needs.filter((scope) => scope !== missing);
			expect(sessionScopesOf({ kind: "mobile", granted })).not.toContain(
				"vault",
			);
		}
		expect(sessionScopesOf({ kind: "mobile", granted: null })).not.toContain(
			"vault",
		);
	});

	it("never gives it to a device session or an API key, whatever they store", () => {
		for (const kind of ["device", "apiKey"] as const) {
			expect(
				sessionScopesOf({
					kind,
					granted: [...needs, "write:settings", "admin"],
				}),
			).not.toContain("vault");
		}
	});

	it("cannot be requested as a token scope", () => {
		expect(parseScopeList("read vault").unknown).toEqual(["vault"]);
	});
});

describe("mayCall", () => {
	it("checks session scopes apart from token scopes", () => {
		const principal = { scopes: ["read" as const], sessionScopes: [] };
		expect(mayCall(principal, "read")).toBe(true);
		expect(mayCall(principal, "account:delete")).toBe(false);
		expect(
			mayCall(
				{ ...principal, sessionScopes: ["account:delete"] },
				"account:delete",
			),
		).toBe(true);
	});

	it("cannot be requested as a token scope", () => {
		expect(parseScopeList("read account:delete").unknown).toEqual([
			"account:delete",
		]);
	});
});
