// Shared by the ratchet test and the ratchet script: walk src/ and messages/,
// apply allow.json, count hits per rule and file, read and write
// baseline.json, and compare both with the merge base with main (git).
// Limits: see the top of rules.ts.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { HERE, REPO_ROOT } from "./paths";
import { type Hit, inScope, RULES, scanFile } from "./rules";

export const BASELINE_PATH = join(HERE, "baseline.json");
export const ALLOW_PATH = join(HERE, "allow.json");

export type Counts = Record<string, Record<string, number>>;
export type Allow = { rule: string; file: string; reason: string };

function walkDir(dir: string, out: string[]) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walkDir(p, out);
		else out.push(p);
	}
}

export function sourceFiles(root = REPO_ROOT): string[] {
	const all: string[] = [];
	walkDir(join(root, "src"), all);
	walkDir(join(root, "messages"), all);
	return all
		.map((p) => relative(root, p).split("\\").join("/"))
		.filter(inScope)
		.sort();
}

export function loadAllow(): Allow[] {
	return existsSync(ALLOW_PATH)
		? (JSON.parse(readFileSync(ALLOW_PATH, "utf8")) as Allow[])
		: [];
}

export function loadBaseline(path = BASELINE_PATH): Counts {
	return existsSync(path)
		? (JSON.parse(readFileSync(path, "utf8")) as Counts)
		: {};
}

export function collectHits(root = REPO_ROOT, allow = loadAllow()): Hit[] {
	const skip = new Set(allow.map((a) => `${a.rule}\0${a.file}`));
	const hits: Hit[] = [];
	for (const file of sourceFiles(root)) {
		for (const h of scanFile(file, readFileSync(join(root, file), "utf8"))) {
			if (!skip.has(`${h.rule}\0${h.file}`)) hits.push(h);
		}
	}
	return hits;
}

export function countHits(hits: Hit[]): Counts {
	const c: Counts = {};
	for (const h of hits) {
		const byFile = c[h.rule] ?? {};
		c[h.rule] = byFile;
		byFile[h.file] = (byFile[h.file] ?? 0) + (h.count ?? 1);
	}
	return c;
}

/** Stable output: sorted rules and files, tab indent, trailing newline. */
export function formatBaseline(c: Counts): string {
	const sorted: Counts = {};
	for (const rule of Object.keys(c).sort()) {
		const files = Object.keys(c[rule] ?? {}).sort();
		if (!files.length) continue;
		const out: Record<string, number> = {};
		for (const f of files) out[f] = c[rule]?.[f] ?? 0;
		sorted[rule] = out;
	}
	return `${JSON.stringify(sorted, null, "\t")}\n`;
}

export function writeBaseline(c: Counts) {
	writeFileSync(BASELINE_PATH, formatBaseline(c));
}

export function writeAllow(allow: Allow[]) {
	writeFileSync(ALLOW_PATH, `${JSON.stringify(allow, null, "\t")}\n`);
}

/** A path, or with a trailing slash every path under that folder, moved from `from` to `to`. */
function movePath(file: string, from: string, to: string): string | undefined {
	if (from.endsWith("/"))
		return file.startsWith(from) ? to + file.slice(from.length) : undefined;
	return file === from ? to : undefined;
}

/**
 * `pnpm ui:ratchet --rename <old> <new>`: carry a moved file's (or folder's,
 * with trailing slashes) counts and allow.json entries over to its new path.
 */
export function renameFile(
	counts: Counts,
	allow: Allow[],
	from: string,
	to: string,
): { counts: Counts; allow: Allow[]; moved: number } {
	let moved = 0;
	const out: Counts = {};
	for (const [rule, files] of Object.entries(counts)) {
		const next: Record<string, number> = {};
		for (const [file, n] of Object.entries(files)) {
			const dest = movePath(file, from, to);
			if (dest) moved++;
			next[dest ?? file] = (next[dest ?? file] ?? 0) + n;
		}
		out[rule] = next;
	}
	const nextAllow = allow.map((a) => {
		const dest = movePath(a.file, from, to);
		if (dest) moved++;
		return dest ? { ...a, file: dest } : a;
	});
	return { counts: out, allow: nextAllow, moved };
}

// ---- the guard against raising (compares with the merge base with main) ----

/** Runs git in the repo; undefined when git fails or is missing. */
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

/** The commit message line that allows a raise: `ui-ratchet-raise: <reason>`. */
export const RAISE_LINE = /^\s*ui-ratchet-raise:\s*\S/;

export type Guard =
	| { skipped: string }
	| { base: string; raised: string[]; reasons: string[] };

const repoPath = (p: string) => relative(REPO_ROOT, p).split("\\").join("/");

/**
 * Compare baseline.json and allow.json with their copies at the merge base
 * with main: every count above it and every new allow entry is `raised`.
 * Renames git detects (`git diff -M`) carry their counts along. `reasons` are
 * the `ui-ratchet-raise:` lines of the commits since the merge base; a raise
 * passes only when there is one. Skipped without git or a merge base (a
 * shallow clone: CI needs the full history).
 */
export function ratchetGuard(
	git: Git = runGit,
	work: { baseline: Counts; allow: Allow[] } = {
		baseline: loadBaseline(),
		allow: loadAllow(),
	},
): Guard {
	if (git(["rev-parse", "--git-dir"]) === undefined)
		return { skipped: "git is not available" };
	const base = (
		git(["merge-base", "HEAD", "main"]) ??
		git(["merge-base", "HEAD", "origin/main"])
	)?.trim();
	if (!base)
		return {
			skipped:
				"no merge base with main or origin/main (a shallow clone? fetch the full history)",
		};
	const renames: [string, string][] = [];
	for (const l of (
		git(["diff", "-M", "--name-status", base, "--", "src", "messages"]) ?? ""
	).split("\n")) {
		const [status, from, to] = l.split("\t");
		if (status?.startsWith("R") && from && to) renames.push([from, to]);
	}
	const show = (p: string) => git(["show", `${base}:${repoPath(p)}`]);
	let baseCounts = JSON.parse(show(BASELINE_PATH) ?? "{}") as Counts;
	let baseAllow = JSON.parse(show(ALLOW_PATH) ?? "[]") as Allow[];
	for (const [from, to] of renames)
		({ counts: baseCounts, allow: baseAllow } = renameFile(
			baseCounts,
			baseAllow,
			from,
			to,
		));
	const known = new Set(baseAllow.map((a) => `${a.rule}\0${a.file}`));
	const raised = [
		...raisedSince(baseCounts, work.baseline),
		...work.allow
			.filter((a) => !known.has(`${a.rule}\0${a.file}`))
			.map((a) => `allow.json: new entry ${a.rule} ${a.file}`),
	];
	const reasons = (git(["log", "--format=%B", `${base}..HEAD`]) ?? "")
		.split("\n")
		.filter((l) => RAISE_LINE.test(l))
		.map((l) => l.trim());
	return { base, raised, reasons };
}

/**
 * Compare a working baseline with the base branch's copy. One line per rule
 * and file whose count is higher than on base or that is new. Lower or
 * removed entries are fine. This stops `--init` from hiding a new violation.
 */
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

/** Rules whose count is not a number of violations (UI-150 counts lines over the limit). */
const MEASURES = new Set(["UI-150"]);

/**
 * Totals per rule, and the files with the most hits, for docs/ui/GAPS.md.
 * UI-150 is listed in lines over the limit and left out of the totals and
 * the file ranking.
 */
export function report(c: Counts, top = 15): string {
	const lines: string[] = [
		"| Rule | Hits | Files | What |",
		"|---|---|---|---|",
	];
	let total = 0;
	const perFile: Record<string, number> = {};
	for (const rule of Object.keys(c).sort()) {
		const files = c[rule] ?? {};
		const n = Object.values(files).reduce((a, b) => a + b, 0);
		const what = (RULES[rule] ?? "").split(";")[0];
		if (MEASURES.has(rule)) {
			lines.push(
				`| ${rule} | ${n} lines over | ${Object.keys(files).length} | ${what} |`,
			);
			continue;
		}
		total += n;
		for (const [f, k] of Object.entries(files))
			perFile[f] = (perFile[f] ?? 0) + k;
		lines.push(`| ${rule} | ${n} | ${Object.keys(files).length} | ${what} |`);
	}
	lines.push(
		`| Total | ${total} | ${Object.keys(perFile).length} | |`,
		"",
		"| File | Hits | Rules |",
		"|---|---|---|",
	);
	const ranked = Object.entries(perFile).sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	for (const [f, n] of ranked.slice(0, top)) {
		const rules = Object.keys(c)
			.sort()
			.filter((r) => c[r]?.[f] && !MEASURES.has(r))
			.map((r) => `${r} ${c[r]?.[f]}`)
			.join(", ");
		lines.push(`| ${f} | ${n} | ${rules} |`);
	}
	return lines.join("\n");
}
