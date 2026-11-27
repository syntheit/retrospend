/**
 * M3 PR0: the inventory of every writer of the category table, found by
 * search (AGENTS 6.8), so a new writer cannot appear without category-
 * writers.ts being read. Two searches:
 *
 * - statements that name the table (client calls, raw SQL, nested writes
 *   through the user relation), counted per file;
 * - callers of the functions that write it without naming it (create,
 *   update, the seeds, the income names, the restore's insert).
 *
 * Not in the list because no statement names the table: the user delete's
 * cascade, and prisma/migrations (shipped ones never change, and a migration
 * runs once before any of this code).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CALLERS, WRITERS } from "./category-writers";

const ROOT = join(__dirname, "../../../..");

// Whitespace and line breaks may sit between the parts of a call.
const CLIENT =
	/\.category\s*\.\s*(update|updateMany|create|createMany|upsert|delete|deleteMany)\b/g;
const RAW =
	/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+("public"\.)?"?category"?\b/gi;
// A nested write through a relation: user.update({ data: { categories: { create } } }),
// or a row that creates its category (expense.create({ data: { category: { create } } })).
const NESTED =
	/\b(categories|category)\s*:\s*\{\s*(create|createMany|update|updateMany|upsert|connectOrCreate|delete|deleteMany)\b/;

const SKIP_DIR = new Set([
	"node_modules",
	".next",
	"generated",
	"dist",
	".git",
]);
const isTestSupport = (path: string) =>
	/\.test\.tsx?$|__tests__|\/src\/test\/|test-support|test-fixtures|characterization-fixtures|merge-kit|expense-write-kit|\/e2e\//.test(
		`/${path}`,
	);

function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, out);
		else if (/\.(ts|tsx|js|mjs|sql|go)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/** Every searched file that is not test support or a shipped migration. */
function searched(): { rel: string; text: string }[] {
	const files: { rel: string; text: string }[] = [];
	for (const dir of [
		"src",
		"scripts",
		"packages",
		"apps/mobile/src",
		"sidecar",
		"prisma",
	]) {
		let found: string[] = [];
		try {
			found = sources(join(ROOT, dir));
		} catch {
			continue;
		}
		for (const file of found) {
			const rel = relative(ROOT, file);
			if (isTestSupport(rel) || rel.startsWith("prisma/migrations/")) continue;
			files.push({ rel, text: readFileSync(file, "utf8") });
		}
	}
	return files;
}

const FILES = searched();

describe("category writers", () => {
	it("are exactly the files and statement counts category-writers.ts names", () => {
		const found: Record<string, number> = {};
		for (const { rel, text } of FILES) {
			const n =
				(text.match(CLIENT)?.length ?? 0) + (text.match(RAW)?.length ?? 0);
			if (n > 0) found[rel] = n;
		}
		const named = Object.fromEntries(
			Object.entries(WRITERS).map(([file, [n]]) => [file, n]),
		);
		expect(found).toEqual(named);
	});

	it("none writes through a nested relation", () => {
		const nested = FILES.filter(({ text }) => NESTED.test(text)).map(
			({ rel }) => rel,
		);
		expect(nested).toEqual([]);
	});

	it("each class is one the slice names, with its statements described", () => {
		for (const [, [n, cls, what]] of Object.entries(WRITERS)) {
			expect(["device-covered", "online", "not versioned"]).toContain(cls);
			expect(n).toBeGreaterThan(0);
			expect(what.length).toBeGreaterThan(0);
		}
	});

	it("every caller of a function that writes through them is named", () => {
		const defining = new Set([
			"src/server/services/category.service.ts",
			"src/server/services/category/category-writers.ts",
		]);
		const found: Record<string, string[]> = {};
		for (const name of Object.keys(CALLERS)) {
			const call = new RegExp(`\\b${name}\\s*\\(`);
			const files = FILES.filter(
				({ rel, text }) =>
					!defining.has(rel) &&
					rel.endsWith(".ts") &&
					!rel.startsWith("apps/mobile/") &&
					!rel.startsWith("packages/") &&
					// A function's own definition is not a call.
					!new RegExp(`function\\s+${name}\\b`).test(text) &&
					call.test(text),
			).map(({ rel }) => rel);
			found[name] = files.sort();
		}
		const named = Object.fromEntries(
			Object.entries(CALLERS).map(([name, files]) => [name, [...files].sort()]),
		);
		expect(found).toEqual(named);
	});
});
