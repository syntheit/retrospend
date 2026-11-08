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

	it("never lets a line break in a contact add a field of its own", () => {
		for (const contact of [
			"mailto:a@b.c\nExpires: 1999-01-01T00:00:00Z",
			"mailto:a@b.c\r\nExpires: 1999-01-01T00:00:00Z",
			"https://example.com/x\nExpires: 1999-01-01T00:00:00Z",
			"https://example.com/a b",
			"mailto:a@b.c extra",
		]) {
			const text = securityTxt({ contact, now: NOW });
			expect(text.match(/^Expires:/gm)).toHaveLength(1);
			expect(text).toContain("Expires: 2027-11-07T12:00:00.000Z");
			expect(text).toContain(`Contact: ${DEFAULT_SECURITY_CONTACT}`);
			expect(text).not.toContain("1999");
		}
	});

	it("splits on commas and keeps only the pieces that are valid contacts", () => {
		const text = securityTxt({
			contact: "https://example.com/report?a=1,b=2,ops@example.com",
			now: NOW,
		});
		expect(text).toContain("Contact: https://example.com/report?a=1\n");
		expect(text).toContain("Contact: mailto:ops@example.com\n");
		expect(text).not.toContain("b=2");
	});

	it("rejects things that only start like a link", () => {
		for (const contact of [
			"mailto:",
			"mailto:nobody",
			"https://",
			"http://example.com",
			"javascript:alert(1)",
		]) {
			expect(securityTxt({ contact, now: NOW })).toContain(
				`Contact: ${DEFAULT_SECURITY_CONTACT}`,
			);
		}
	});

	it("drops a public URL with a line break or a bad scheme", () => {
		for (const publicUrl of [
			"https://a.example\nExpires: 1999-01-01T00:00:00Z",
			"javascript:alert(1)",
			"not a url",
		]) {
			const text = securityTxt({ publicUrl, now: NOW });
			expect(text).not.toContain("Canonical:");
			expect(text).not.toContain("1999");
		}
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
