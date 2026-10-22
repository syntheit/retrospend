// The domain boundary: @retrospend/domain runs unchanged on the server, in the
// browser and in React Native, so it may import only its own files and the
// dependencies declared in its package.json, and none of those may be a
// framework, the database client or a Node built-in. This file lives outside
// src/ because it needs node:fs, which the package itself may not use.
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = import.meta.dirname;
const SRC = join(ROOT, "src");
const FORBIDDEN = [
	"next",
	"prisma",
	"react",
	"react-dom",
	"react-native",
	"server-only",
];

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};
const dependencies = Object.keys(pkg.dependencies ?? {});
const devDependencies = Object.keys(pkg.devDependencies ?? {});

// Static imports take a quoted string; only import() and require() calls can
// take a template literal. Keeping backticks to calls stops prose in comments
// ("from `month`") from reading as an import.
const SPECIFIER =
	/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]/g;
/** Every JS or TS module, so a .js or .mts file cannot slip past the scan. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

function specifiers(source: string): string[] {
	return [...source.matchAll(SPECIFIER)].map(
		(m) => (m[1] ?? m[2] ?? m[3]) as string,
	);
}

/** "@scope/name/sub" -> "@scope/name", "name/sub" -> "name". */
function packageName(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@")
		? parts.slice(0, 2).join("/")
		: (parts[0] as string);
}

function isForbidden(name: string): boolean {
	return (
		name.startsWith("node:") ||
		builtinModules.includes(name) ||
		name.startsWith("@prisma/") ||
		name.startsWith("~") ||
		FORBIDDEN.includes(name)
	);
}

describe("@retrospend/domain boundary", () => {
	it("declares no framework, database or Node dependency", () => {
		expect([...dependencies, ...devDependencies].filter(isForbidden)).toEqual(
			[],
		);
	});

	it("imports only its own files and declared dependencies", () => {
		const violations: string[] = [];
		for (const file of readdirSync(SRC, {
			recursive: true,
			encoding: "utf8",
		})) {
			if (!SOURCE_FILE.test(file)) continue;
			const allowed = TEST_FILE.test(file)
				? [...dependencies, ...devDependencies]
				: dependencies;
			for (const spec of specifiers(readFileSync(join(SRC, file), "utf8"))) {
				if (spec.startsWith(".")) {
					const target = join(dirname(join(SRC, file)), spec);
					if (relative(SRC, target).startsWith("..")) {
						violations.push(`${file}: ${spec} leaves src/`);
					}
					continue;
				}
				const name = packageName(spec);
				if (isForbidden(name) || !allowed.includes(name)) {
					violations.push(`${file}: ${spec}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("finds static, type, re-export, dynamic and template-literal imports", () => {
		const source = [
			'import { db } from "~/server/db";',
			'import type { Prisma } from "@prisma/client";',
			'export * from "./money";',
			'const React = await import("react");',
			"const fs = await import(`node:fs`);",
			"// the period starts from `month`, which is not an import",
		].join("\n");
		expect(specifiers(source)).toEqual([
			"~/server/db",
			"@prisma/client",
			"./money",
			"react",
			"node:fs",
		]);
		expect(
			["~/server/db", "@prisma/client", "react", "fs", "node:fs"].every((s) =>
				isForbidden(packageName(s)),
			),
		).toBe(true);
	});

	it("scans every JS and TS module, not only .ts", () => {
		const scanned = ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cts"];
		expect(scanned.every((f) => SOURCE_FILE.test(f))).toBe(true);
		expect(["a.json", "a.md", "a.css"].some((f) => SOURCE_FILE.test(f))).toBe(
			false,
		);
		expect(TEST_FILE.test("money.test.mts")).toBe(true);
	});
});
