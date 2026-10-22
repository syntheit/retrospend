// pnpm ui:ratchet                      lower baseline.json to today's counts (never raises, never adds)
// pnpm ui:ratchet --rename <old> <new>  carry a moved file's counts and allow.json entries to
//                                      its new path (folders: end both paths with "/")
// pnpm ui:ratchet --report             print totals per rule and the top files (for docs/ui/GAPS.md)
// pnpm ui:ratchet --check-base <f>     fail if baseline.json is higher than, or has entries
//                                      not in, that base copy
// pnpm ui:ratchet --init               write the full current baseline
//
// --init exists for the first baseline and for re-seeding after a NEW RULE is
// added or a rule is fixed. Never use it to hide a new violation: fix the code
// instead. The ratchet test compares baseline.json and allow.json with the
// merge base with main and fails on any raise unless a commit message on the
// branch has a line `ui-ratchet-raise: <reason>`.
import { readFileSync } from "node:fs";
import {
	type Counts,
	collectHits,
	countHits,
	loadAllow,
	loadBaseline,
	raisedSince,
	renameFile,
	report,
	writeAllow,
	writeBaseline,
} from "./scan";

const args = process.argv.slice(2);
const renameIdx = args.indexOf("--rename");

if (renameIdx >= 0) {
	const from = args[renameIdx + 1];
	const to = args[renameIdx + 2];
	if (!from || !to || from.endsWith("/") !== to.endsWith("/")) {
		console.error(
			"usage: pnpm ui:ratchet --rename <old path> <new path>   (repo-relative; folders end with /)",
		);
		process.exit(2);
	}
	const base = loadBaseline();
	const allow = loadAllow();
	const next = renameFile(base, allow, from, to);
	if (!next.moved) {
		console.error(`nothing in baseline.json or allow.json is under ${from}`);
		process.exit(1);
	}
	writeBaseline(next.counts);
	if (JSON.stringify(next.allow) !== JSON.stringify(allow))
		writeAllow(next.allow);
	console.log(`moved ${next.moved} entries from ${from} to ${to}`);
	process.exit(0);
}
const baseIdx = args.indexOf("--check-base");

if (baseIdx >= 0) {
	const path = args[baseIdx + 1];
	if (!path) {
		console.error(
			"usage: pnpm ui:ratchet --check-base <path to the base branch's baseline.json>",
		);
		process.exit(2);
	}
	const raised = raisedSince(
		JSON.parse(readFileSync(path, "utf8")) as Counts,
		loadBaseline(),
	);
	if (raised.length) {
		console.error(
			`baseline.json is higher than the base branch (fix the code, do not raise the baseline):\n  ${raised.join("\n  ")}`,
		);
		process.exit(1);
	}
	console.log("baseline.json is not above the base branch");
	process.exit(0);
}

const current = countHits(collectHits());

if (args.includes("--report")) {
	console.log(report(current));
} else if (args.includes("--init")) {
	writeBaseline(current);
	const total = Object.values(current).reduce(
		(n, f) => n + Object.values(f).reduce((a, b) => a + b, 0),
		0,
	);
	console.log(
		`baseline written: ${total} hits across ${Object.keys(current).length} rules`,
	);
} else {
	const base = loadBaseline();
	const next: Counts = {};
	const above: string[] = [];
	let lowered = 0;
	for (const rule of Object.keys(base)) {
		for (const [file, was] of Object.entries(base[rule] ?? {})) {
			const now = current[rule]?.[file] ?? 0;
			if (now > was) above.push(`${rule} ${file}: ${now} > baseline ${was}`);
			const keep = Math.min(now, was);
			if (keep < was) lowered += was - keep;
			if (keep > 0) next[rule] = { ...next[rule], [file]: keep };
		}
	}
	for (const rule of Object.keys(current)) {
		for (const [file, now] of Object.entries(current[rule] ?? {})) {
			if (base[rule]?.[file] === undefined)
				above.push(
					`${rule} ${file}: ${now} new (if the file was renamed or moved: pnpm ui:ratchet --rename <old path> ${file})`,
				);
		}
	}
	if (above.length) {
		console.error(
			`new violations above the baseline (the ratchet never raises it; fix the code):\n  ${above.join("\n  ")}`,
		);
		process.exit(1);
	}
	writeBaseline(next);
	console.log(
		lowered ? `baseline lowered by ${lowered}` : "baseline already tight",
	);
}
