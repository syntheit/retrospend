// Catches: a string built from input reaching $queryRawUnsafe or $executeRawUnsafe
// (SQL injection), including the forms that hide the argument.
// `$queryRawUnsafe` and `$executeRawUnsafe` take a string, so a string built
// from input is an injection. Outside tests, every reference to them must be
// a plain `x.$queryRawUnsafe(<argument>)` call whose argument is a string
// literal (a template literal without `${}` counts) or Prisma.sql. Optional
// calls, `.call` and `.apply`, bracket access, aliases and destructuring all
// hide the argument, so each one fails. Anything dynamic goes through the
// tagged `$queryRaw` / `$executeRaw`, which parameterize.
// Test files are skipped: they run fixed SQL through the owner client.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const NAME = /\$(?:query|execute)RawUnsafe\b/g;

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

/**
 * Line numbers of every reference to an Unsafe method in `source` that is not
 * a plain `x.$queryRawUnsafe(<safe argument>)` call. Comments are ignored.
 */
function unsafeRawCalls(source: string): number[] {
	const text = withoutComments(source);
	const lines: number[] = [];
	for (const m of text.matchAll(NAME)) {
		const memberCall = text[m.index - 1] === "." && text[m.index - 2] !== "?";
		let i = skipGenerics(text, m.index + m[0].length);
		while (/\s/.test(text[i] ?? "")) i++;
		let safe = false;
		if (memberCall && text[i] === "(") {
			i++;
			while (/\s/.test(text[i] ?? "")) i++;
			safe = isSafeArgument(text, i);
		}
		if (!safe) lines.push(text.slice(0, m.index).split("\n").length);
	}
	return lines;
}

/** The one file that names the methods without calling them: the scoped client's refusal list. */
const NAMES_ONLY = join(REPO_ROOT, "src", "server", "db-core.ts");

const isTestPath = /\.test\.tsx?$|[\\/]__tests__[\\/]|[\\/]src[\\/]test[\\/]/;

const sourceFiles = () =>
	scanSources({
		roots: ["src", "packages", "scripts"],
		include: /\.tsx?$/,
		exclude: isTestPath,
	});

describe("raw Unsafe SQL", () => {
	it("passes only a string literal or Prisma.sql, anywhere in src, packages and scripts", () => {
		const offenders = sourceFiles()
			.filter((file) => file !== NAMES_ONLY)
			.flatMap((file) =>
				unsafeRawCalls(readFileSync(file, "utf8")).map(
					(line) => `${relative(REPO_ROOT, file)}:${line}`,
				),
			);
		expect(offenders).toEqual([]);
	});

	it("reads the files it is meant to scan", () => {
		const files = sourceFiles();
		expect(files.length).toBeGreaterThan(500);
		expect(files).toContain(NAMES_ONLY);
		expect(files.some((f) => f.startsWith(join(REPO_ROOT, "scripts")))).toBe(
			true,
		);
	});

	it("the refusal list in db-core.ts is the only place that names a method without calling it", () => {
		expect(unsafeRawCalls(readFileSync(NAMES_ONLY, "utf8"))).toHaveLength(2);
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
			"/**\n * $executeRawUnsafe(`x ${y}`) in a doc comment\n */",
			"db.$queryRawUnsafe('SELECT 1'); // not $executeRawUnsafe(sql)",
			"/* db.$queryRawUnsafe(sql) */ db.$executeRawUnsafe('x')",
			'const u = "https://x"; db.$queryRawUnsafe("SELECT 1");',
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

	it("rejects every form that hides the argument", () => {
		const bad = [
			"db?.$queryRawUnsafe('SELECT 1')",
			"db.$queryRawUnsafe?.(sql)",
			"db.$queryRawUnsafe?.('SELECT 1')",
			"db.$queryRawUnsafe.call(db, 'SELECT 1')",
			"db.$executeRawUnsafe.apply(db, [sql])",
			'db["$queryRawUnsafe"](sql)',
			"db['$executeRawUnsafe']('SELECT 1')",
			"const q = db.$queryRawUnsafe;",
			"const { $queryRawUnsafe } = db;",
			'const names = ["$queryRawUnsafe"];',
			"$queryRawUnsafe('SELECT 1')",
		];
		for (const text of bad) expect(unsafeRawCalls(text), text).toEqual([1]);
	});

	it("a // inside a string or after a block comment does not hide a call", () => {
		const bad = [
			'const u = "https://x"; await db.$queryRawUnsafe(sql)',
			"const u = 'a//b'; await db.$queryRawUnsafe(sql)",
			"const u = `https://${host}/x`; await db.$queryRawUnsafe(sql)",
			"const u = `a ${`//`} b`; await db.$queryRawUnsafe(sql)",
			"/* // */ await db.$queryRawUnsafe(sql)",
			"/* a */ /* // */ await db.$queryRawUnsafe(sql)",
			"const r = { a: 1 }; const u = `${r.a}`; // fine\nawait db.$queryRawUnsafe(sql)",
		];
		for (const text of bad) {
			expect(unsafeRawCalls(text), text).toEqual([text.split("\n").length]);
		}
	});

	it("reports the line of the call", () => {
		expect(unsafeRawCalls("a\nb\ndb.$queryRawUnsafe(sql)\n")).toEqual([3]);
	});
});
