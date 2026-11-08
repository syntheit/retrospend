import { existsSync } from "node:fs";
import { join } from "node:path";
import tokens from "@retrospend/tokens/tokens.json";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "~/proxy";
import manifest from "../manifest";

describe("web app manifest", () => {
	const m = manifest();

	it("installs as a standalone app that opens on Home", () => {
		expect(m.name).toBe("Retrospend");
		expect(m.short_name).toBe("Retrospend");
		expect(m.start_url).toBe("/home");
		expect(m.display).toBe("standalone");
	});

	it("takes its colors from the design tokens", () => {
		expect(m.background_color).toBe(tokens.light["color.bg"]);
		expect(m.theme_color).toBe(tokens.light["color.bg"]);
		expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("points at icons that exist in public", () => {
		expect(m.icons?.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
		for (const icon of m.icons ?? []) {
			expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
		}
	});
});

describe("proxy and the manifest", () => {
	it.each([
		"/manifest.webmanifest",
		"/android-chrome-192x192.png",
		"/android-chrome-512x512.png",
		"/apple-touch-icon.png",
	])("lets %s through without a session or a redirect", (path) => {
		const res = proxy(new NextRequest(`https://retrospend.app${path}`));
		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
	});

	it.each([
		"/home",
		"/android-chrome-evil",
		"/android-chrome-192x192.png/x",
		"/manifest.webmanifest/x",
	])("still sends %s to sign in", (path) => {
		const res = proxy(new NextRequest(`https://retrospend.app${path}`));
		expect(res.headers.get("location")).toContain("/login");
	});
});
