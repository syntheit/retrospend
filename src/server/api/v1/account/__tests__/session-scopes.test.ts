import { parseScopeList } from "@retrospend/api-contract/common";
import { describe, expect, it } from "vitest";
import { mayCall, sessionScopesOf } from "../../scopes";

const held = ["account:delete"];

describe("sessionScopesOf", () => {
	it("gives account deletion to the web app and the Expo app only", () => {
		expect(sessionScopesOf({ kind: "web", granted: null })).toEqual(held);
		expect(sessionScopesOf({ kind: "mobile", granted: null })).toEqual([]);
		expect(
			sessionScopesOf({ kind: "mobile", granted: ["read", "write:settings"] }),
		).toEqual(held);
		expect(sessionScopesOf({ kind: "mobile", granted: ["read"] })).toEqual([]);
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
