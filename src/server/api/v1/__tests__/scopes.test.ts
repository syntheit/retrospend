import { describe, expect, it } from "vitest";
import {
	apiKeyScopes,
	capDeviceScopes,
	effectiveScopes,
	hasScope,
	isMobileAppRequest,
	sessionKind,
} from "../scopes";

describe("effectiveScopes", () => {
	it("gives an unscoped web session every scope, admin only to admins", () => {
		expect(
			effectiveScopes({ kind: "web", granted: null, role: "USER" }),
		).toEqual(["read", "write:expenses", "write:money", "write:settings"]);
		expect(
			effectiveScopes({ kind: "web", granted: null, role: "ADMIN" }),
		).toContain("admin");
	});

	it("gives an unscoped mobile session everything but admin, even for admins", () => {
		expect(
			effectiveScopes({ kind: "mobile", granted: null, role: "ADMIN" }),
		).not.toContain("admin");
	});

	it("uses stored scopes on any kind", () => {
		for (const kind of ["web", "mobile", "device"] as const) {
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

describe("sessionKind", () => {
	it("reads the kind from the stamped client id, not the transport", () => {
		expect(sessionKind("retrospend-mobile", false)).toBe("mobile");
		expect(sessionKind("retrospend-cli", false)).toBe("device");
		expect(sessionKind(null, false)).toBe("web");
		expect(sessionKind(null, true)).toBe("mobile");
	});
});

describe("capDeviceScopes", () => {
	it("keeps what the approver may use and defaults to read", () => {
		expect(capDeviceScopes("read admin", "USER")).toEqual(["read"]);
		expect(capDeviceScopes("read admin", "ADMIN")).toEqual(["read", "admin"]);
		expect(capDeviceScopes(undefined, "USER")).toEqual(["read"]);
		expect(capDeviceScopes("admin", "USER")).toEqual(["read"]);
	});
});

describe("isMobileAppRequest", () => {
	it("recognizes the Expo client by expo-origin or the app scheme", () => {
		expect(isMobileAppRequest(new Headers({ "expo-origin": "x" }))).toBe(true);
		expect(
			isMobileAppRequest(new Headers({ origin: "retrospend://callback" })),
		).toBe(true);
		expect(
			isMobileAppRequest(new Headers({ origin: "https://retrospend.app" })),
		).toBe(false);
		expect(isMobileAppRequest(undefined)).toBe(false);
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
