/**
 * @jest-environment node
 */
/// <reference types="node" />
// The Google-free guard (IMPLEMENTATION §4). Rules live in google-free.json;
// scripts/check-google-free.sh applies its Maven half to the Gradle tree.
// A banned package may ship only through npmExemptions, and only once a
// product flavor or an autolinking exclude keeps it out of the Google-free
// build (google-free.json, futureGooglePath). expo-notifications is the one
// exemption: excluded from Android autolinking, imported by *.ios.ts only.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import config from "../app.config";
import rules from "../google-free.json";

const APP_DIR = join(__dirname, "..");
const OPTIONAL_DIR = join(APP_DIR, rules.optionalDir);
const SOURCE_DIRS = ["app", "src"];
const BANNED = rules.npm.map((r) => ({ ...r, regex: new RegExp(r.pattern) }));

interface Exemption {
	name: string;
	keptOutBy: "productFlavor" | "autolinkingExclude";
	how: string;
}
const EXEMPTIONS = rules.npmExemptions as Exemption[];
const EXEMPT = new Set(EXEMPTIONS.map((e) => e.name));

interface Manifest {
	name?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

function bannedReason(packageName: string): string | null {
	return BANNED.find((r) => r.regex.test(packageName))?.why ?? null;
}

/** "@scope/name/sub/path" -> "@scope/name"; "name/sub" -> "name". */
function packageOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@")
		? parts.slice(0, 2).join("/")
		: (parts[0] ?? specifier);
}

/**
 * Where a package's own dependencies are linked. pnpm puts them next to the
 * package (.pnpm/<id>/node_modules/<dep>); a workspace project keeps them in
 * its own node_modules. Searching further up would find packages that are
 * merely hoisted for the web app, not linked for this one.
 */
function dependencyRoot(packageDir: string): string {
	const parent = dirname(packageDir);
	const owner = basename(parent).startsWith("@") ? dirname(parent) : parent;
	return basename(owner) === "node_modules"
		? owner
		: join(packageDir, "node_modules");
}

function findPackageDir(name: string, requesterDir: string): string | null {
	const manifest = join(dependencyRoot(requesterDir), name, "package.json");
	return existsSync(manifest) ? realpathSync(dirname(manifest)) : null;
}

function readManifest(dir: string): Manifest {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

/**
 * Every package the app ships: dependencies, optional and installed peer
 * dependencies, followed transitively from apps/mobile/package.json.
 * devDependencies (jest and friends) never reach a build.
 */
function shippedPackages(): Map<string, string[]> {
	const chains = new Map<string, string[]>();
	const seenDirs = new Set<string>();
	const queue: { dir: string; chain: string[] }[] = [
		{ dir: realpathSync(APP_DIR), chain: [] },
	];
	while (queue.length > 0) {
		const next = queue.shift();
		if (!next || seenDirs.has(next.dir)) continue;
		seenDirs.add(next.dir);
		const manifest = readManifest(next.dir);
		const names = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.optionalDependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		]);
		for (const name of names) {
			const dir = findPackageDir(name, next.dir);
			if (!dir) continue; // an optional or peer dependency nobody installed
			const chain = [...next.chain, name];
			if (!chains.has(name)) chains.set(name, chain);
			queue.push({ dir, chain });
		}
	}
	return chains;
}

const IMPORT =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** Package specifiers a source file imports or requires. */
function importedPackages(source: string): string[] {
	return [...source.matchAll(IMPORT)]
		.map((m) => m[1] ?? "")
		.filter((s) => s && !s.startsWith(".") && !s.startsWith("@/"))
		.map(packageOf);
}

function sourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return path === OPTIONAL_DIR ? [] : sourceFiles(path);
		}
		return /\.(m|c)?[jt]sx?$/.test(entry.name) ? [path] : [];
	});
}

describe("google-free guard", () => {
	it("recognizes the banned packages it is meant to catch", () => {
		expect(
			importedPackages(
				[
					'import messaging from "@react-native-firebase/messaging";',
					"const c = require('@react-native-firebase/crashlytics');",
					'import "expo-notifications";',
					'const m = await import("react-native-maps");',
				].join("\n"),
			).map(bannedReason),
		).toEqual([
			expect.any(String),
			expect.any(String),
			expect.any(String),
			expect.any(String),
		]);
		expect(bannedReason("expo-secure-store")).toBeNull();
		expect(bannedReason("@retrospend/domain")).toBeNull();
	});

	it("ships no Google services package", () => {
		const shipped = shippedPackages();
		// The walk must have reached the native stack, or it proves nothing.
		expect(shipped.has("react-native")).toBe(true);
		expect(shipped.has("expo-modules-core")).toBe(true);
		const offenders = [...shipped]
			.filter(([name]) => bannedReason(name) && !EXEMPT.has(name))
			.map(([name, chain]) => `${chain.join(" > ")}: ${bannedReason(name)}`);
		expect(offenders).toEqual([]);
	});

	it(`imports Google services only under ${rules.optionalDir}/`, () => {
		const files = SOURCE_DIRS.flatMap((d) => sourceFiles(join(APP_DIR, d)));
		expect(files.length).toBeGreaterThan(0);
		// An exempt package is linked on iOS only, so only iOS files import it.
		const allowed = (file: string, name: string) =>
			EXEMPT.has(name) && /\.ios\.tsx?$/.test(file);
		const offenders = files.flatMap((file) =>
			importedPackages(readFileSync(file, "utf8"))
				.filter((name) => bannedReason(name) && !allowed(file, name))
				.map(
					(name) => `${relative(APP_DIR, file).split(sep).join("/")}: ${name}`,
				),
		);
		expect(offenders).toEqual([]);
	});

	it("exempts a package only with a named way to keep it out", () => {
		for (const exemption of EXEMPTIONS) {
			expect(bannedReason(exemption.name)).not.toBeNull(); // no stale entries
			expect(["productFlavor", "autolinkingExclude"]).toContain(
				exemption.keptOutBy,
			);
			expect(exemption.how.trim()).not.toBe("");
		}
	});

	it("keeps every exempt package out of the Android autolinking", () => {
		const pkg = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8"));
		const excluded: string[] = pkg.expo?.autolinking?.android?.exclude ?? [];
		for (const exemption of EXEMPTIONS) {
			expect(excluded).toContain(exemption.name);
		}
	});

	it("adds no Google services config plugin", () => {
		const plugins = (config.plugins ?? []).map((p) =>
			Array.isArray(p) ? String(p[0]) : String(p),
		);
		expect(plugins.filter((name) => bannedReason(packageOf(name)))).toEqual([]);
		expect(config.android?.googleServicesFile).toBeUndefined();
		expect(config.ios?.googleServicesFile).toBeUndefined();
	});
});
