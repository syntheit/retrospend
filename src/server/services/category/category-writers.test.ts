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
import { CALLERS, VERSION_SETTERS, WRITERS } from "./category-writers";

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

	it("only the writers VERSION_SETTERS names set the version: updateCategoryIn, a restore's insert, the default-category script", () => {
		// A category write that names the version in what it stores, whatever the
		// value (a number, a stash field, an increment): any `version` key in a
		// `data` object written inline in a client write, an assignment on a
		// `data` object built apart (`data.version =`), or raw SQL setting the
		// column. It does not follow a `data` object built elsewhere and passed
		// by name (`const d = { version: 5 }; update({ data: d })`): no writer
		// does that today, and a new one would show up as an unlisted writer or
		// caller above. A `version` in a `where` or `select` only reads, and a
		// stash field is no write.
		const DATA_ASSIGN = /\bdata\.version\s*=/g;
		const RAW_SET = /\bSET\b[^;`]*"version"/g;
		// The files that write the table or call what does, and any file about categories.
		const writerFiles = new Set([
			...Object.keys(WRITERS),
			...Object.values(CALLERS).flat(),
		]);
		const found: Record<string, number> = {};
		for (const { rel, text } of FILES) {
			// The inventory itself describes the writes in prose.
			if (rel === "src/server/services/category/category-writers.ts") continue;
			if (!writerFiles.has(rel) && !/categor/i.test(rel)) continue;
			// Comments explain; they write nothing.
			const code = text
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			const n =
				dataValues(code).filter((data) => /\bversion\s*:/.test(data)).length +
				(code.match(DATA_ASSIGN)?.length ?? 0) +
				(code.match(RAW_SET)?.length ?? 0);
			if (n > 0) found[rel] = n;
		}
		const named = Object.fromEntries(
			Object.entries(VERSION_SETTERS).map(([file, [n]]) => [file, n]),
		);
		expect(found).toEqual(named);
		for (const [file, [, what]] of Object.entries(VERSION_SETTERS))
			expect(what.length, file).toBeGreaterThan(0);
	});

	it("sees a version key of any shape in a category write's data", () => {
		const shapes = [
			"tx.category.update({ where: { id }, data: { version: 5 } })",
			"tx.category.update({ where: { id }, data: { version: stash.version } })",
			"tx.category.create({ data: { ...(x ? {} : { version: x }), userId } })",
			"tx.category.updateMany({ where: {}, data: { name, version: { set: 1 } } })",
		];
		for (const shape of shapes)
			expect(
				dataValues(shape).filter((data) => /\bversion\s*:/.test(data)),
				shape,
			).toHaveLength(1);
		// Reading the version, or filtering by it, writes nothing.
		for (const read of [
			"tx.category.update({ where: { id, version: 3 }, data: { color } })",
			"tx.category.findMany({ where: { id }, select: { version: true } })",
		])
			expect(
				dataValues(read).filter((data) => /\bversion\s*:/.test(data)),
				read,
			).toHaveLength(0);
	});
});

/** The value of the `data` argument of every client write in `code` (a braced object, or the bare name). */
function dataValues(code: string): string[] {
	const values: string[] = [];
	for (const call of code.matchAll(CLIENT)) {
		const open = code.indexOf("(", call.index ?? 0);
		const args = argsOf(code, open + 1);
		const at = args.search(/\bdata\s*:/);
		if (at < 0) continue;
		const rest = args.slice(args.indexOf(":", at) + 1).trimStart();
		values.push(rest.startsWith("{") ? braced(rest) : (rest.split(/[,}]/)[0] ?? ""));
	}
	return values;
}

/** The text of a call's arguments, to its closing parenthesis. */
function argsOf(code: string, from: number): string {
	let depth = 1;
	let i = from;
	while (depth > 0 && i < code.length) {
		const ch = code[i++];
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
	}
	return code.slice(from, i - 1);
}

/** The braced object at the start of `text`, braces included. */
function braced(text: string): string {
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}" && --depth === 0) return text.slice(0, i + 1);
	}
	return text;
}
