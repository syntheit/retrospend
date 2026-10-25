// No em dash anywhere in code comments, docs or CSS (AGENTS.md rule 10).
// UI-120 covers strings in UI code and the message catalogs; this test covers
// the rest (comments in .ts/.tsx/.css, and .md files) with a target of zero.
// It is not part of the ratchet: there is no baseline, one hit fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

/** U+2014, written as a code so this file has no em dash in it. */
const EM_DASH = String.fromCharCode(0x2014);
const ROOTS = ["src", "packages", "apps", "docs/ui"];
const SKIP_DIRS = new Set([
	"node_modules",
	".next",
	".expo",
	"dist",
	"build",
	"ios",
	"android",
	"coverage",
]);
const EXTENSIONS = /\.(ts|tsx|css|md|mdx)$/;

function walk(dir: string, out: string[]) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (EXTENSIONS.test(name)) out.push(path);
	}
}

describe("no em dash in comments and docs", () => {
	it("finds none under src, packages, apps and docs/ui", () => {
		const files: string[] = [];
		for (const root of ROOTS) walk(join(REPO_ROOT, root), files);
		const found: string[] = [];
		for (const file of files) {
			readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, i) => {
					if (line.includes(EM_DASH))
						found.push(`${relative(REPO_ROOT, file)}:${i + 1}`);
				});
		}
		expect(
			found,
			"Em dash found; use a comma, colon, period or parentheses (AGENTS.md rule 10)",
		).toEqual([]);
	});
});
