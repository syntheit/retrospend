import { describe, expect, it } from "vitest";
import { getClientIp, ipBucket } from "./rate-limiter";

const headers = (h: Record<string, string>) => new Headers(h);

describe("getClientIp", () => {
	it("prefers CF-Connecting-IP over the forwarded list", () => {
		expect(
			getClientIp(
				headers({
					"cf-connecting-ip": "198.51.100.7",
					"x-forwarded-for": "1.1.1.1, 10.0.0.2",
				}),
			),
		).toBe("198.51.100.7");
	});

	it("takes the last forwarded entry, the one the proxy added", () => {
		expect(
			getClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
		).toBe("203.0.113.9");
	});

	it("falls back to x-real-ip, then unknown", () => {
		expect(getClientIp(headers({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
		expect(getClientIp(headers({}))).toBe("unknown");
	});
});

describe("ipBucket", () => {
	it("leaves IPv4 and unknown alone", () => {
		expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
		expect(ipBucket("unknown")).toBe("unknown");
	});

	it("puts every address in one IPv6 /64 in the same bucket", () => {
		const a = ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
		expect(a).toBe("2001:db8:1:2::/64");
		expect(ipBucket("2001:0db8:0001:0002:1111:2222:3333:4444")).toBe(a);
		expect(ipBucket("2001:db8:1:2::1")).toBe(a);
	});

	it("keeps different /64s apart and expands a leading ::", () => {
		expect(ipBucket("2001:db8:1:3::1")).not.toBe(ipBucket("2001:db8:1:2::1"));
		expect(ipBucket("::1")).toBe("0:0:0:0::/64");
	});
});
