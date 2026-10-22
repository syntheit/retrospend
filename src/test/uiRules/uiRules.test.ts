// The ratchet over the real source tree (UI-140). Rules: docs/ui/CHECKLIST.md.
// A new violation fails here with file:line. A fix only warns (run
// `pnpm ui:ratchet` to lower the baseline), so a merge never turns main red.
// baseline.json and allow.json may not rise above their copies at the merge
// base with main unless a commit on the branch says `ui-ratchet-raise: <why>`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";
import { RULES } from "./rules";
import {
	collectHits,
	countHits,
	type Git,
	loadAllow,
	loadBaseline,
	raisedSince,
	ratchetGuard,
	renameFile,
} from "./scan";

describe("uiRules ratchet", () => {
	it("allow.json entries name a known rule, a real file and a real reason", () => {
		for (const a of loadAllow()) {
			expect(RULES[a.rule], `allow.json: unknown rule ${a.rule}`).toBeDefined();
			expect(
				a.reason.trim().length,
				`allow.json: ${a.rule} ${a.file} needs a real reason`,
			).toBeGreaterThan(20);
			expect(
				existsSync(join(REPO_ROOT, a.file)),
				`allow.json: ${a.file} does not exist`,
			).toBe(true);
		}
	});

	it("baseline.json only names known rules and real files", () => {
		const base = loadBaseline();
		for (const rule of Object.keys(base)) {
			expect(RULES[rule], `baseline.json: unknown rule ${rule}`).toBeDefined();
			for (const file of Object.keys(base[rule] ?? {})) {
				expect(
					existsSync(join(REPO_ROOT, file)),
					`baseline.json: ${file} does not exist; run pnpm ui:ratchet (deleted) or pnpm ui:ratchet --rename ${file} <new path> (moved)`,
				).toBe(true);
			}
		}
	});

	it("UI source stays at or below the baseline", () => {
		const hits = collectHits();
		const now = countHits(hits);
		const base = loadBaseline();
		const problems: string[] = [];
		const loose: string[] = [];
		const rules = new Set([...Object.keys(now), ...Object.keys(base)]);
		for (const rule of [...rules].sort()) {
			const files = new Set([
				...Object.keys(now[rule] ?? {}),
				...Object.keys(base[rule] ?? {}),
			]);
			for (const file of [...files].sort()) {
				const n = now[rule]?.[file] ?? 0;
				const b = base[rule]?.[file] ?? 0;
				if (n > b) {
					const lines = hits
						.filter((h) => h.rule === rule && h.file === file)
						.map((h) => `    ${file}:${h.line}  ${rule}  \`${h.match}\``)
						.join("\n");
					const moved =
						base[rule]?.[file] === undefined
							? `\n    If this file was renamed or moved, carry its counts over: pnpm ui:ratchet --rename <old path> ${file}`
							: "";
					problems.push(
						`${rule} ${file}: ${n} hits, baseline allows ${b} (${n - b} new).\n${lines}\n    ${RULES[rule]}${moved}`,
					);
				} else if (n < b) {
					loose.push(`${rule} ${file}: baseline ${b}, now ${n}`);
				}
			}
		}
		// Below the baseline never fails (a merge must not turn main red); it
		// asks for the ratchet to be tightened.
		if (loose.length)
			console.warn(
				`uiRules: ${loose.length} counts are below the baseline. Run \`pnpm ui:ratchet\` to tighten it:\n  ${loose.slice(0, 20).join("\n  ")}${loose.length > 20 ? "\n  ..." : ""}`,
			);
		expect(problems, `\n${problems.join("\n\n")}\n`).toEqual([]);
		// The scan takes about 0.7 s; the long timeout only covers a busy machine.
	}, 30_000);

	it("baseline.json and allow.json are not raised since main without a ui-ratchet-raise reason", () => {
		const g = ratchetGuard();
		if ("skipped" in g) {
			console.warn(
				`uiRules: skipped the check against main's baseline: ${g.skipped}`,
			);
			return;
		}
		const why = `
baseline.json or allow.json is above the merge base with main (${g.base.slice(0, 9)}):
  ${g.raised.join("\n  ")}
Fix the code instead. If raising is right (a new rule, a rule fix that finds old
violations, a move git does not see as a rename), add a line to a commit message
on this branch:  ui-ratchet-raise: <reason>
`;
		if (!g.reasons.length) expect(g.raised, why).toEqual([]);
	});

	it("raisedSince flags raised and added entries, not lowered or removed ones", () => {
		const base = {
			"UI-010": { "src/a.tsx": 3, "src/b.tsx": 2 },
			"UI-001": { "src/c.ts": 1 },
		};
		expect(raisedSince(base, base)).toEqual([]);
		expect(raisedSince(base, { "UI-010": { "src/a.tsx": 1 } })).toEqual([]);
		expect(
			raisedSince(base, { "UI-010": { "src/a.tsx": 4, "src/b.tsx": 2 } }),
		).toEqual(["UI-010 src/a.tsx: raised 3 -> 4"]);
		expect(
			raisedSince(base, { ...base, "UI-012": { "src/d.tsx": 1 } }),
		).toEqual(["UI-012 src/d.tsx: added with 1"]);
	});

	it("ratchetGuard compares with the merge base and reads ui-ratchet-raise lines", () => {
		const fake =
			(files: Record<string, string>, log = "", diff = ""): Git =>
			(args) => {
				if (args[0] === "rev-parse") return ".git";
				if (args[0] === "merge-base") return "abc123\n";
				if (args[0] === "diff") return diff;
				if (args[0] === "log") return log;
				if (args[0] === "show")
					return files[(args[1] ?? "").replace(/^abc123:/, "")];
				return undefined;
			};
		const base = {
			"src/test/uiRules/baseline.json": JSON.stringify({
				"UI-010": { "src/a.tsx": 2 },
			}),
			"src/test/uiRules/allow.json": JSON.stringify([
				{ rule: "UI-001", file: "src/og.tsx", reason: "x" },
			]),
		};
		const same = {
			baseline: { "UI-010": { "src/a.tsx": 2 } },
			allow: [{ rule: "UI-001", file: "src/og.tsx", reason: "x" }],
		};
		expect(ratchetGuard(fake(base), same)).toEqual({
			base: "abc123",
			raised: [],
			reasons: [],
		});
		const raised = ratchetGuard(
			fake(base, "Fix\n\nui-ratchet-raise: new rule\n"),
			{
				baseline: { "UI-010": { "src/a.tsx": 3 } },
				allow: [
					...same.allow,
					{ rule: "UI-002", file: "src/b.tsx", reason: "y" },
				],
			},
		);
		expect(raised).toEqual({
			base: "abc123",
			raised: [
				"UI-010 src/a.tsx: raised 2 -> 3",
				"allow.json: new entry UI-002 src/b.tsx",
			],
			reasons: ["ui-ratchet-raise: new rule"],
		});
		// a rename git sees carries the counts and the allow entries along
		expect(
			ratchetGuard(
				fake(base, "", "R095\tsrc/a.tsx\tsrc/c.tsx\nM\tsrc/d.tsx\n"),
				{
					baseline: { "UI-010": { "src/c.tsx": 2 } },
					allow: same.allow,
				},
			),
		).toEqual({ base: "abc123", raised: [], reasons: [] });
		// no baseline at the merge base: every entry is new
		expect(ratchetGuard(fake({}), same)).toMatchObject({
			raised: [
				"UI-010 src/a.tsx: added with 2",
				"allow.json: new entry UI-001 src/og.tsx",
			],
		});
		expect(ratchetGuard(() => undefined, same)).toEqual({
			skipped: "git is not available",
		});
		const noBase: Git = (args) =>
			args[0] === "rev-parse" ? ".git" : undefined;
		expect(ratchetGuard(noBase, same)).toHaveProperty("skipped");
	});

	it("renameFile moves counts and allow entries, files or folders", () => {
		const counts = {
			"UI-010": { "src/a/x.tsx": 2, "src/b.tsx": 1 },
			"UI-020": { "src/a/x.tsx": 1, "src/c.tsx": 4 },
		};
		const allow = [{ rule: "UI-001", file: "src/a/x.tsx", reason: "r" }];
		expect(renameFile(counts, allow, "src/a/x.tsx", "src/z.tsx")).toEqual({
			counts: {
				"UI-010": { "src/z.tsx": 2, "src/b.tsx": 1 },
				"UI-020": { "src/z.tsx": 1, "src/c.tsx": 4 },
			},
			allow: [{ rule: "UI-001", file: "src/z.tsx", reason: "r" }],
			moved: 3,
		});
		expect(renameFile(counts, allow, "src/a/", "src/n/").counts).toEqual({
			"UI-010": { "src/n/x.tsx": 2, "src/b.tsx": 1 },
			"UI-020": { "src/n/x.tsx": 1, "src/c.tsx": 4 },
		});
		expect(renameFile(counts, allow, "src/none.tsx", "src/z.tsx").moved).toBe(
			0,
		);
	});
});
