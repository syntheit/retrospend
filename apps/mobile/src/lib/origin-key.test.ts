import { createHash } from "node:crypto";
import { originOf, serverKey, sha256Hex } from "./origin-key";

describe("sha256Hex", () => {
	it.each([
		"",
		"abc",
		"https://retrospend.app",
		"a".repeat(55),
		"a".repeat(56),
		"a".repeat(64),
		"é € 漢字",
	])("matches node's sha256 for %j", (text) => {
		expect(sha256Hex(text)).toBe(
			createHash("sha256").update(text).digest("hex"),
		);
	});
});

describe("serverKey", () => {
	it("ignores case, path and trailing slash", () => {
		expect(originOf("HTTPS://Retrospend.App/base/")).toBe(
			"https://retrospend.app",
		);
		expect(serverKey("https://retrospend.app")).toBe(
			serverKey("https://RETROSPEND.app/x"),
		);
	});

	it("differs per origin, scheme and port", () => {
		const keys = new Set([
			serverKey("https://retrospend.app"),
			serverKey("http://retrospend.app"),
			serverKey("https://retrospend.app:8443"),
			serverKey("https://other.example"),
		]);
		expect(keys.size).toBe(4);
		for (const key of keys) expect(key).toMatch(/^[0-9a-f]{32}$/);
	});
});
