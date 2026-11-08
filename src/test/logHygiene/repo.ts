// Walks the code that can log and applies the baseline. Shared by the test.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_METADATA_KEYS } from "~/server/services/api-v1/event-metadata-keys";
import { type Lang, type LogHit, scanSource } from "./scan";

export const HERE = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const BASELINE_PATH = join(HERE, "baseline.json");

/** rule -> file -> number of hits. May only shrink (see logHygiene.test.ts). */
export type Counts = Record<string, Record<string, number>>;

/** Roots that ship code that runs against real data. */
const ROOTS = ["src", "apps/mobile/src", "packages", "sidecar"];
const SKIP_DIRS = new Set([
	"node_modules",
	".next",
	"generated",
	"dist",
	"__tests__",
	"test",
	"scripts",
]);

/**
 * Files that are the sink of the thing the rule checks, so the rule applies
 * to their callers instead. Keep this list short; a reason is required.
 */
export const SINKS: Record<string, string> = {
	"src/server/services/audit.service.ts":
		"logEvent forwards its caller's metadata; every caller is checked by LOG-020",
};

const isTest = (p: string) => /\.(test|spec)\.[tj]sx?$|_test\.go$/.test(p);

function walk(dir: string, out: string[]) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (!SKIP_DIRS.has(name)) walk(p, out);
		} else out.push(p);
	}
}

export function sourceFiles(root = REPO_ROOT): string[] {
	const all: string[] = [];
	for (const r of ROOTS)
		if (existsSync(join(root, r))) walk(join(root, r), all);
	return all
		.map((p) => relative(root, p).split("\\").join("/"))
		.filter((p) => /\.(ts|tsx)$/.test(p) || p.endsWith(".go"))
		.filter((p) => !isTest(p) && !p.endsWith(".d.ts"))
		.filter((p) => !SINKS[p])
		.sort();
}

export function langOf(file: string): Lang {
	return file.endsWith(".go") ? "go" : "ts";
}

export type FileHit = LogHit & { file: string };

export function collectHits(root = REPO_ROOT): FileHit[] {
	const hits: FileHit[] = [];
	for (const file of sourceFiles(root)) {
		const src = readFileSync(join(root, file), "utf8");
		for (const h of scanSource(src, langOf(file), EVENT_METADATA_KEYS))
			hits.push({ ...h, file });
	}
	return hits;
}

export function countHits(hits: FileHit[]): Counts {
	const out: Counts = {};
	for (const h of hits) {
		const files = out[h.rule] ?? {};
		files[h.file] = (files[h.file] ?? 0) + 1;
		out[h.rule] = files;
	}
	return out;
}

export function loadBaseline(): Counts {
	return existsSync(BASELINE_PATH)
		? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Counts)
		: {};
}

/** One line per rule and file whose count is above `base` or that is new. */
export function raisedSince(base: Counts, work: Counts): string[] {
	const out: string[] = [];
	for (const rule of Object.keys(work).sort()) {
		for (const file of Object.keys(work[rule] ?? {}).sort()) {
			const was = base[rule]?.[file];
			const now = work[rule]?.[file] ?? 0;
			if (was === undefined) out.push(`${rule} ${file}: added with ${now}`);
			else if (now > was) out.push(`${rule} ${file}: raised ${was} -> ${now}`);
		}
	}
	return out;
}

export type Git = (args: string[]) => string | undefined;

export const runGit: Git = (args) => {
	try {
		return execFileSync("git", args, {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch {
		return undefined;
	}
};

/** The commit message line that allows a raise: `log-hygiene-raise: <reason>`. */
export const RAISE_LINE = /^\s*log-hygiene-raise:\s*\S/;

export type Guard =
	| { skipped: string }
	| { base: string; raised: string[]; reasons: string[] };

/**
 * Compare the working baseline with its copy at the merge base with main.
 * Skipped without git, without a merge base (a shallow clone) or when main
 * has no baseline yet (the branch that adds it).
 */
export function raiseGuard(
	git: Git = runGit,
	work: Counts = loadBaseline(),
): Guard {
	if (git(["rev-parse", "--git-dir"]) === undefined)
		return { skipped: "git is not available" };
	const base = (
		git(["merge-base", "HEAD", "main"]) ??
		git(["merge-base", "HEAD", "origin/main"])
	)?.trim();
	if (!base) return { skipped: "no merge base with main or origin/main" };
	const was = git([
		"show",
		`${base}:${relative(REPO_ROOT, BASELINE_PATH).split("\\").join("/")}`,
	]);
	if (was === undefined)
		return { skipped: "main has no log hygiene baseline yet" };
	const reasons = (git(["log", "--format=%B", `${base}..HEAD`]) ?? "")
		.split("\n")
		.filter((l) => RAISE_LINE.test(l))
		.map((l) => l.trim());
	return {
		base,
		raised: raisedSince(JSON.parse(was) as Counts, work),
		reasons,
	};
}
