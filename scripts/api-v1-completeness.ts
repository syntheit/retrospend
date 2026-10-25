/**
 * The API v1 completeness report (IMPLEMENTATION S3, milestone 6): every tRPC
 * procedure, with the v1 routes that do its job or the written reason it has
 * none. The reasons live in api-v1-completeness.map.ts.
 *
 *   pnpm exec tsx --env-file-if-exists=.env scripts/api-v1-completeness.ts
 *
 * Prints one line per procedure and a summary; exits 1 when a procedure has
 * no entry, an entry names no procedure, or an entry names a route the
 * contract does not have. src/server/api/v1/__tests__/completeness.test.ts
 * runs the same check in CI.
 */
import { contract, listContractRoutes } from "@retrospend/api-contract";
import { appRouter } from "../src/server/api/root";
import {
	COMPLETENESS,
	type Entry,
	type ReasonKind,
} from "./api-v1-completeness.map";

export type Row = {
	procedure: string;
	type: string;
	routes: string[];
	kind: ReasonKind | null;
	why: string | null;
};

export type Report = {
	rows: Row[];
	/** Procedures with no entry in the map. */
	unexplained: string[];
	/** Entries that name no procedure. */
	stale: string[];
	/** Routes an entry names that the contract does not have. */
	missingRoutes: string[];
	/** Entries with a reason kind but no words. */
	blankReasons: string[];
	/** Contract routes no procedure maps to (new in v1 beyond the web). */
	v1Only: string[];
	counts: Record<ReasonKind | "route", number>;
};

/** Every tRPC procedure as `router.procedure` (nested routers dotted), with its type. */
export function listProcedures(): { procedure: string; type: string }[] {
	const all = (
		appRouter as unknown as {
			_def: { procedures: Record<string, { _def: { type: string } }> };
		}
	)._def.procedures;
	return Object.entries(all)
		.map(([procedure, p]) => ({ procedure, type: p._def.type }))
		.sort((a, b) => a.procedure.localeCompare(b.procedure));
}

/** Every v1 route as `METHOD /path`. */
export function listRouteKeys(): Set<string> {
	return new Set(
		listContractRoutes(contract).map((r) => `${r.method} ${r.path}`),
	);
}

export function buildReport(
	map: Readonly<Record<string, Entry>> = COMPLETENESS,
): Report {
	const procedures = listProcedures();
	const known = new Set(procedures.map((p) => p.procedure));
	const routes = listRouteKeys();
	const used = new Set<string>();
	const rows: Row[] = [];
	const unexplained: string[] = [];
	const missingRoutes: string[] = [];
	const blankReasons: string[] = [];
	const counts: Report["counts"] = {
		route: 0,
		internal: 0,
		"web-only": 0,
		superseded: 0,
		"g5-platform": 0,
		gap: 0,
	};

	for (const { procedure, type } of procedures) {
		const entry = map[procedure];
		if (!entry) {
			unexplained.push(procedure);
			continue;
		}
		if ("routes" in entry) {
			counts.route++;
			for (const r of entry.routes) {
				used.add(r);
				if (!routes.has(r)) missingRoutes.push(`${procedure}: ${r}`);
			}
			rows.push({
				procedure,
				type,
				routes: [...entry.routes],
				kind: null,
				why: null,
			});
		} else {
			counts[entry.kind]++;
			if (!entry.why.trim()) blankReasons.push(procedure);
			rows.push({
				procedure,
				type,
				routes: [],
				kind: entry.kind,
				why: entry.why,
			});
		}
	}
	return {
		rows,
		unexplained,
		stale: Object.keys(map).filter((k) => !known.has(k)),
		missingRoutes,
		blankReasons,
		v1Only: [...routes].filter((r) => !used.has(r)).sort(),
		counts,
	};
}

export function formatReport(report: Report): string {
	const lines = report.rows.map((r) =>
		r.routes.length > 0
			? `${r.procedure}  ->  ${r.routes.join(", ")}`
			: `${r.procedure}  [${r.kind}]  ${r.why}`,
	);
	const c = report.counts;
	lines.push(
		"",
		`${report.rows.length} procedures: ${c.route} with a v1 route, ${c.internal} internal, ${c["web-only"]} web-only, ${c.superseded} superseded, ${c["g5-platform"]} platform, ${c.gap} gaps`,
		`unexplained: ${report.unexplained.length}, stale entries: ${report.stale.length}, unknown routes: ${report.missingRoutes.length}`,
	);
	return lines.join("\n");
}

export function isClean(report: Report): boolean {
	return (
		report.unexplained.length === 0 &&
		report.stale.length === 0 &&
		report.missingRoutes.length === 0 &&
		report.blankReasons.length === 0
	);
}

if (process.argv[1]?.endsWith("api-v1-completeness.ts")) {
	const report = buildReport();
	console.log(formatReport(report));
	if (!isClean(report)) {
		for (const key of [
			"unexplained",
			"stale",
			"missingRoutes",
			"blankReasons",
		] as const)
			for (const item of report[key]) console.error(`${key}: ${item}`);
		process.exit(1);
	}
	process.exit(0);
}
