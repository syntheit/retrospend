import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: {
		SECURITY_CONTACT: undefined,
		PUBLIC_URL: "https://money.example.com/",
	},
}));

import { NextRequest } from "next/server";
import { env } from "~/env";
import { DEFAULT_SECURITY_CONTACT, securityTxt } from "~/lib/security-txt";
import { proxy } from "~/proxy";
import { GET } from "../security.txt/route";

const NOW = new Date("2026-11-08T12:00:00.000Z");

describe("securityTxt", () => {
	it("has the required fields, the default contact and a canonical built from the public URL", () => {
		const lines = securityTxt({
			publicUrl: "https://money.example.com/",
			now: NOW,
		}).split("\n");
		expect(lines).toContain(`Contact: ${DEFAULT_SECURITY_CONTACT}`);
		expect(lines).toContain("Preferred-Languages: en");
		expect(lines).toContain(
			"Canonical: https://money.example.com/.well-known/security.txt",
		);
		// 364 days after the fixed clock.
		expect(lines).toContain("Expires: 2027-11-07T12:00:00.000Z");
	});

	it("uses the operator's contacts, adds mailto: to a bare address and skips junk", () => {
		const text = securityTxt({
			contact: "ops@example.com, https://example.com/report, nonsense, ",
			now: NOW,
		});
		expect(text).toContain("Contact: mailto:ops@example.com\n");
		expect(text).toContain("Contact: https://example.com/report\n");
		expect(text).not.toContain("nonsense");
		expect(text).not.toContain(DEFAULT_SECURITY_CONTACT);
	});

	it("falls back to the default when every setting value is junk", () => {
		expect(securityTxt({ contact: "nonsense", now: NOW })).toContain(
			`Contact: ${DEFAULT_SECURITY_CONTACT}`,
		);
	});

	it("leaves Canonical out without a public URL", () => {
		expect(securityTxt({ now: NOW })).not.toContain("Canonical:");
	});
});

describe("security.txt route", () => {
	it("serves plain text with an Expires date in the future", async () => {
		const res = GET();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		const body = await res.text();
		const expires = /^Expires: (.+)$/m.exec(body)?.[1];
		expect(expires).toBeDefined();
		expect(new Date(expires ?? "").getTime()).toBeGreaterThan(Date.now());
		expect(body).toContain(
			"Canonical: https://money.example.com/.well-known/security.txt",
		);
	});

	it("reads the contact from the setting", async () => {
		(env as { SECURITY_CONTACT?: string }).SECURITY_CONTACT =
			"mailto:sec@example.com";
		expect(await GET().text()).toContain("Contact: mailto:sec@example.com\n");
	});

	it("passes the proxy without a session or a redirect", () => {
		const res = proxy(
			new NextRequest("https://retrospend.app/.well-known/security.txt"),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
	});
});
