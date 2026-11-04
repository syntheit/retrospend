import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../proxy";

const req = (path: string, cookie?: string) =>
	new NextRequest(`http://localhost:1997${path}`, {
		headers: cookie ? { cookie } : {},
	});

const nonceOf = (csp: string | null) =>
	/'nonce-([^']+)'/.exec(csp ?? "")?.[1];

describe("proxy security headers", () => {
	it("sends a nonce policy on a public page and forwards the nonce to the app", () => {
		const res = proxy(req("/login"));
		const csp = res.headers.get("content-security-policy");
		const nonce = nonceOf(csp);
		expect(nonce).toBeTruthy();
		expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
		// NextResponse.next({ request }) forwards request headers this way.
		expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
		expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(
			csp,
		);
	});

	it("uses a new nonce for every request", () => {
		const a = nonceOf(proxy(req("/login")).headers.get("content-security-policy"));
		const b = nonceOf(proxy(req("/login")).headers.get("content-security-policy"));
		expect(a).not.toBe(b);
	});

	it("covers the sign-in redirect too, and keeps the other headers", () => {
		const res = proxy(req("/activity"));
		expect(res.status).toBe(307);
		expect(res.headers.get("location")).toContain("/login?callbackUrl=%2Factivity");
		expect(nonceOf(res.headers.get("content-security-policy"))).toBeTruthy();
		expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("covers a signed-in page and reports Trusted Types without enforcing it", () => {
		const res = proxy(req("/activity", "better-auth.session_token=abc"));
		expect(res.status).toBe(200);
		expect(nonceOf(res.headers.get("content-security-policy"))).toBeTruthy();
		expect(res.headers.get("content-security-policy")).not.toContain(
			"trusted-types",
		);
		expect(res.headers.get("content-security-policy-report-only")).toContain(
			"require-trusted-types-for 'script'",
		);
	});
});
