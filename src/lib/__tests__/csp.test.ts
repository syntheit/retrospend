import { describe, expect, it, vi } from "vitest";
import {
	buildCsp,
	newNonce,
	TRUSTED_TYPES_REPORT_ONLY,
	WORKER_CSP,
} from "../csp";

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
		expect(scripts).toBe(
			"'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval'",
		);
		expect(scripts).not.toContain("unsafe-inline");
		// 'wasm-unsafe-eval' (libsodium) is not 'unsafe-eval' (JavaScript eval).
		expect(scripts?.split(" ")).not.toContain("'unsafe-eval'");
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

describe("workers", () => {
	it("lets the page start a worker from its own origin and nowhere else", () => {
		for (const dev of [true, false]) {
			const workers = directive(buildCsp("n", dev), "worker-src");
			expect(workers).toBe("'self'");
			for (const source of ["blob:", "data:", "*", "https:", "http:"])
				expect(workers?.split(" ")).not.toContain(source);
		}
	});

	it("gives a worker's own script no network but its origin and no eval", () => {
		expect(WORKER_CSP).toBe(
			"default-src 'none'; script-src 'self'; connect-src 'self'",
		);
		expect(WORKER_CSP).not.toMatch(/unsafe-eval|unsafe-inline|blob:|data:|\*/);
	});

	it("is sent by next.config on the chunks a worker loads, from the same value", async () => {
		vi.stubEnv("SKIP_ENV_VALIDATION", "1");
		const config = (await import("../../../next.config.js")).default;
		const rules = await (
			config as {
				headers: () => Promise<
					{ source: string; headers: { key: string; value: string }[] }[]
				>;
			}
		).headers();
		const rule = rules.find((r) => r.source === "/_next/static/chunks/:path*");
		expect(rule?.headers).toEqual([
			{ key: "Content-Security-Policy", value: WORKER_CSP },
		]);
		// Nothing else under /_next/static, and no page, gets this policy.
		expect(rules).toHaveLength(1);
		vi.unstubAllEnvs();
	});
});
