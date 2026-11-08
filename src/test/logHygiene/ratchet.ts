// pnpm log:ratchet         lower baseline.json to today's counts (never raises, never adds)
// pnpm log:ratchet --init  write the full current baseline (first baseline, or a new rule)
//
// Never use --init to hide a new violation: fix the code instead. The test
// compares baseline.json with the merge base with main and fails on a raise
// unless a commit message has a line `log-hygiene-raise: <reason>`.
import { writeFileSync } from "node:fs";
import {
	BASELINE_PATH,
	type Counts,
	collectHits,
	countHits,
	loadBaseline,
} from "./repo";

const now = countHits(collectHits());
const init = process.argv.includes("--init");
const base = loadBaseline();
const next: Counts = {};
for (const rule of Object.keys(now).sort()) {
	for (const [file, n] of Object.entries(now[rule] ?? {}).sort()) {
		const allowed = init ? n : base[rule]?.[file];
		if (allowed === undefined) continue; // a new hit: the test reports it
		next[rule] = { ...next[rule], [file]: Math.min(n, allowed) };
	}
}
writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, "\t")}\n`);
console.log(
	`baseline: ${Object.values(next).reduce((a, f) => a + Object.keys(f).length, 0)} files`,
);
