import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scoped-session guard parses cookies with better-call's parseCookies
 * so it reads them exactly as getSession does. That only holds while the
 * app's better-call is the copy better-auth itself runs on; a better-auth
 * upgrade that moves its pin must fail here, not quietly split the parsers.
 */
function versionOf(pkg: string, from: string): string {
	const entry = createRequire(from).resolve(pkg);
	let dir = dirname(entry);
	for (;;) {
		try {
			const manifest = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as { name?: string; version: string };
			if (manifest.name === pkg) return manifest.version;
		} catch {
			// No package.json at this level; keep walking up.
		}
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`no package.json for ${pkg}`);
		dir = parent;
	}
}

describe("better-call", () => {
	it("is the same version for the app and for better-auth", () => {
		const root = join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			"..",
			"package.json",
		);
		const betterAuthEntry = createRequire(root).resolve("better-auth");
		expect(versionOf("better-call", root)).toBe(
			versionOf("better-call", betterAuthEntry),
		);
	});
});
