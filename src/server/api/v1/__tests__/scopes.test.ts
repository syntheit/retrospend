import { describe, expect, it } from "vitest";
import { apiKeyScopes, effectiveScopes, hasScope } from "../scopes";

describe("effectiveScopes", () => {
	it("gives a cookie session every scope, admin only to admins", () => {
		expect(
			effectiveScopes({ kind: "cookie", granted: null, role: "USER" }),
		).toEqual(["read", "write:expenses", "write:money", "write:settings"]);
		expect(
			effectiveScopes({ kind: "cookie", granted: null, role: "ADMIN" }),
		).toContain("admin");
	});

	it("gives a mobile bearer session everything but admin, even for admins", () => {
		expect(
			effectiveScopes({ kind: "bearer", granted: null, role: "ADMIN" }),
		).not.toContain("admin");
	});

	it("limits a device session to its stored scopes on any transport", () => {
		for (const kind of ["cookie", "bearer", "device"] as const) {
			expect(
				effectiveScopes({ kind, granted: ["read"], role: "ADMIN" }),
			).toEqual(["read"]);
		}
	});

	it("drops admin from a token once the user is no longer an admin", () => {
		expect(
			effectiveScopes({
				kind: "apiKey",
				granted: ["read", "admin"],
				role: "USER",
			}),
		).toEqual(["read"]);
	});

	it("gives a token with no stored scopes nothing", () => {
		expect(
			effectiveScopes({ kind: "apiKey", granted: null, role: "USER" }),
		).toEqual([]);
	});
});

describe("apiKeyScopes", () => {
	it("reads known scopes and ignores the rest", () => {
		expect(apiKeyScopes({ scopes: ["read", "write:money", "root"] })).toEqual([
			"read",
			"write:money",
		]);
		expect(apiKeyScopes(null)).toEqual([]);
	});
});

describe("hasScope", () => {
	it("lets public routes through and checks the rest", () => {
		expect(hasScope([], "public")).toBe(true);
		expect(hasScope(["read"], "read")).toBe(true);
		expect(hasScope(["read"], "write:expenses")).toBe(false);
	});
});
