import { describe, expect, it } from "vitest";
import { capHostOf, isUnreachable, retryDelayMs } from "./schedule";

describe("capHostOf", () => {
	it("counts subdomains under their registered domain", () => {
		expect(capHostOf("https://a.evil.example/up/1")).toBe("evil.example");
		expect(capHostOf("https://B.Evil.Example./up/2")).toBe("evil.example");
		expect(capHostOf("https://ntfy.sh/topic")).toBe("ntfy.sh");
	});

	it("keeps an address as it is", () => {
		expect(capHostOf("http://10.0.0.5:8080/x")).toBe("10.0.0.5");
		expect(capHostOf("http://[2001:db8::1]/x")).toBe("[2001:db8::1]");
	});

	it("has no host for something that is not a URL", () => {
		expect(capHostOf(null)).toBeNull();
		expect(capHostOf("not a url")).toBeNull();
	});
});

describe("isUnreachable", () => {
	it("is true for errors where nothing answered, false for an answer", () => {
		for (const code of [
			"timeout",
			"connection_refused",
			"connection_error",
			"dns_failed",
			"tls_error",
		])
			expect(isUnreachable(code)).toBe(true);
		for (const code of ["http_503", "blocked_target", "internal_error"])
			expect(isUnreachable(code)).toBe(false);
	});
});

describe("retryDelayMs", () => {
	it("stops after the last attempt", () => {
		expect(retryDelayMs(1)).toBe(30_000);
		expect(retryDelayMs(8)).toBeNull();
	});
});
