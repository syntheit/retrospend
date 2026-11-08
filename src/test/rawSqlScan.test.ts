// `$queryRawUnsafe` and `$executeRawUnsafe` take a string, so a string built
// from input is an injection. Outside tests, every call must pass a string
// literal (a template literal without `${}` counts) or Prisma.sql. Anything
// else goes through the tagged `$queryRaw` / `$executeRaw`, which parameterize.
// Test files are skipped: they run fixed SQL through the owner client.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./uiRules/paths";

const CALL = /\$(?:query|execute)RawUnsafe\b/g;

/** The index just past a balanced `<...>` that starts at `from`, or `from` when there is none. */
function skipGenerics(text: string, from: number): number {
	let i = from;
	while (/\s/.test(text[i] ?? "")) i++;
	if (text[i] !== "<") return from;
	let depth = 0;
	for (; i < text.length; i++) {
		if (text[i] === "<") depth++;
		else if (text[i] === ">" && text[i - 1] !== "=") depth--;
		if (depth === 0) return i + 1;
	}
	return from;
}

/** Whether the argument starting at `start` is a plain literal or Prisma.sql. */
function isSafeArgument(text: string, start: number): boolean {
	const rest = text.slice(start);
	if (/^Prisma\.sql\b/.test(rest)) return true;
	const quote = rest[0];
	if (quote !== '"' && quote !== "'" && quote !== "`") return false;
	for (let i = 1; i < rest.length; i++) {
		const c = rest[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (quote === "`" && c === "$" && rest[i + 1] === "{") return false;
		if (c === quote) {
			// A literal must be the whole argument: `"a" + b` is not one.
			return /^\s*[,)]/.test(rest.slice(i + 1));
		}
	}
	return false;
}

/** Line numbers of every Unsafe call in `text` whose argument is not safe. */
function unsafeRawCalls(text: string): number[] {
	const lines: number[] = [];
	for (const m of text.matchAll(CALL)) {
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		if (/^\s*(\*|\/\/|\/\*)/.test(text.slice(lineStart, m.index))) continue;
		let i = skipGenerics(text, m.index + m[0].length);
		while (/\s/.test(text[i] ?? "")) i++;
		// A mention that is not a call (a name in a list) has no `(`.
		if (text[i] !== "(") continue;
		i++;
		while (/\s/.test(text[i] ?? "")) i++;
		if (!isSafeArgument(text, i)) {
			lines.push(text.slice(0, m.index).split("\n").length);
		}
	}
	return lines;
}

const SKIP_DIRS = new Set(["node_modules", "generated", "dist", ".next"]);
const isTestPath = (path: string) =>
	/\.test\.tsx?$/.test(path) ||
	/[\\/]__tests__[\\/]/.test(path) ||
	/[\\/]src[\\/]test[\\/]/.test(path);

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(path);
			} else if (/\.tsx?$/.test(entry.name) && !isTestPath(path)) {
				files.push(path);
			}
		}
	};
	for (const root of ["src", "packages"]) walk(join(REPO_ROOT, root));
	return files;
}

describe("raw Unsafe SQL", () => {
	it("passes only a string literal or Prisma.sql, anywhere in src and packages", () => {
		const offenders = sourceFiles().flatMap((file) =>
			unsafeRawCalls(readFileSync(file, "utf8")).map(
				(line) => `${relative(REPO_ROOT, file)}:${line}`,
			),
		);
		expect(offenders).toEqual([]);
	});

	it("reads the files it is meant to scan", () => {
		expect(sourceFiles().length).toBeGreaterThan(500);
	});
});

describe("the scan itself", () => {
	it("accepts literals and Prisma.sql, with or without a type argument", () => {
		const ok = [
			'db.$executeRawUnsafe("ANALYZE")',
			"db.$queryRawUnsafe<{ n: number }[]>('SELECT 1')",
			"db.$executeRawUnsafe(`DELETE FROM x`)",
			'db.$queryRawUnsafe("SELECT $1", id)',
			"db.$queryRawUnsafe(\n\t\t`SELECT 1`,\n\t)",
			"db.$queryRawUnsafe(Prisma.sql`SELECT 1`)",
			"// call $queryRawUnsafe(sql) never",
			' * $executeRawUnsafe(`x ${y}`) in a doc comment',
			'const names = ["$queryRawUnsafe", "$executeRawUnsafe"];',
		];
		for (const text of ok) expect(unsafeRawCalls(text), text).toEqual([]);
	});

	it("rejects a variable, an interpolated template and a concatenation", () => {
		const bad = [
			"db.$queryRawUnsafe(sql)",
			"db.$executeRawUnsafe(`DELETE FROM ${table}`)",
			'db.$queryRawUnsafe("SELECT " + col)',
			"tx.$queryRawUnsafe<{ ok: boolean }[]>(query, id)",
			"db.$executeRawUnsafe(\n\t\tbuild(),\n\t)",
		];
		for (const text of bad) expect(unsafeRawCalls(text), text).toEqual([1]);
	});

	it("reports the line of the call", () => {
		expect(unsafeRawCalls("a\nb\ndb.$queryRawUnsafe(sql)\n")).toEqual([3]);
	});
});
