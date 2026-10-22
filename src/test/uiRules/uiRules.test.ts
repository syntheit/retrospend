// The ratchet over the real source tree (UI-140). Rules: docs/ui/CHECKLIST.md.
// A new violation fails here with file:line. A fix also fails until the
// baseline is lowered with `pnpm ui:ratchet`, so the count can only go down.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";
import { RULES } from "./rules";
import {
	collectHits,
	countHits,
	loadAllow,
	loadBaseline,
	raisedSince,
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
					`baseline.json: ${file} does not exist; run pnpm ui:ratchet`,
				).toBe(true);
			}
		}
	});

	it("UI source stays at or below the baseline", () => {
		const hits = collectHits();
		const now = countHits(hits);
		const base = loadBaseline();
		const problems: string[] = [];
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
					problems.push(
						`${rule} ${file}: ${n} hits, baseline allows ${b} (${n - b} new).\n${lines}\n    ${RULES[rule]}`,
					);
				} else if (n < b) {
					problems.push(
						`${rule} ${file}: fixed ${b - n} (baseline ${b}, now ${n}). Run \`pnpm ui:ratchet\` to lower the baseline.`,
					);
				}
			}
		}
		expect(problems, `\n${problems.join("\n\n")}\n`).toEqual([]);
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
});
