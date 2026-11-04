import { describe, expect, it } from "vitest";
import { buildCsp, newNonce, TRUSTED_TYPES_REPORT_ONLY } from "../csp";

const directive = (csp: string, name: string) =>
	csp
		.split("; ")
		.find((d) => d.startsWith(`${name} `))
		?.slice(name.length + 1);

describe("newNonce", () => {
	it("is different on every call and safe inside a header", () => {
		const seen = new Set(Array.from({ length: 50 }, () => newNonce()));
		expect(seen.size).toBe(50);
		for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
	});
});

describe("buildCsp", () => {
	it("lets scripts run only with the nonce, never inline", () => {
		const scripts = directive(buildCsp("abc123", false), "script-src");
		expect(scripts).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
		expect(scripts).not.toContain("unsafe-inline");
		expect(scripts).not.toContain("unsafe-eval");
	});

	it("allows eval only in development", () => {
		expect(directive(buildCsp("n", true), "script-src")).toContain(
			"'unsafe-eval'",
		);
	});

	it("blocks plugins, framing, base and form hijacking", () => {
		const csp = buildCsp("n", false);
		expect(directive(csp, "object-src")).toBe("'none'");
		expect(directive(csp, "frame-ancestors")).toBe("'none'");
		expect(directive(csp, "base-uri")).toBe("'self'");
		expect(directive(csp, "form-action")).toBe("'self'");
		expect(directive(csp, "default-src")).toBe("'self'");
		expect(directive(csp, "connect-src")).toBe("'self'");
	});

	it("keeps Trusted Types out of the enforced policy until it is verified", () => {
		expect(buildCsp("n", false)).not.toContain("trusted-types");
		expect(TRUSTED_TYPES_REPORT_ONLY).toContain(
			"require-trusted-types-for 'script'",
		);
	});
});
