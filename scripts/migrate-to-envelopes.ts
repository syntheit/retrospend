/**
 * Moves everyone's old budgets (the `budget` table) into a Limits envelope
 * budget: budget build plan 02 §6. The same function runs lazily on a
 * person's first budget read; this script is the batch (and the rehearsal on
 * a restored prod dump).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/migrate-to-envelopes.ts                 # dry run, everyone
 *   DATABASE_URL=... pnpm tsx scripts/migrate-to-envelopes.ts --user <id>     # one person (repeatable)
 *   DATABASE_URL=... pnpm tsx scripts/migrate-to-envelopes.ts --apply         # write
 *   DATABASE_URL=... pnpm tsx scripts/migrate-to-envelopes.ts --json          # report as JSON
 *   DATABASE_URL=... pnpm tsx scripts/migrate-to-envelopes.ts --rollback <runId|lazy> [--force]
 *
 * Exit code: 0 when every person was moved or needs nothing, 2 when anyone
 * was skipped (no rate), failed or ended up unfunded (also with --json), 1
 * when the script itself failed.
 *
 * --rollback deletes the books of a run (or of every first-read move, "lazy")
 * and hides the answered review expenses again. It does nothing while the
 * envelope flag is on (the next read would move the person again), and it
 * keeps a book the person changed since; --force removes both and prints
 * what that loses.
 *
 * Dry run is the default and writes nothing: each person's move runs in its
 * own transaction and rolls back, so the report is exactly what --apply
 * would write. A person with a book, without budgets, or needing a currency
 * that has no rate is left alone and listed; the old rows are never changed.
 * Run `prisma migrate deploy` first (this needs the P7 migration).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { currencyDecimals } from "../src/lib/money";
import {
	migrateUsers,
	needsAttention,
	rollbackRun,
} from "../src/server/services/envelope/legacy-migrate.batch";
import type { MigrationReport } from "../src/server/services/envelope/legacy-migrate.service";
import { fromMinor } from "../src/server/services/envelope/units";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) =>
	args.flatMap((a, i) =>
		a === name && args[i + 1] ? [args[i + 1] as string] : [],
	);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error("DATABASE_URL environment variable is required.");
	process.exit(1);
}

const pool = new Pool({ connectionString });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

function maskUrl(url: string): string {
	return url.replace(/\/\/([^:@/]+):[^@]*@/, "//$1:***@");
}

/** An exact decimal for minor units (no float): "3087.50". */
function money(minor: number | null, currency: string | null): string {
	if (minor === null || currency === null) return "-";
	return `${currency} ${fromMinor(minor, currency).toFixed(currencyDecimals(currency))}`;
}

function line(r: MigrationReport): string {
	const head = `${r.userId}  ${r.status.padEnd(18)}`;
	if (r.status === "MIGRATED") {
		const kinds = `fixed ${r.fixed}, peg-actual ${r.pegToActual}, peg-last ${r.pegToLastMonth}${r.global ? ", global" : ""}`;
		return `${head} ${r.envelopes} envelopes (${kinds}); before ${money(r.beforeMinor, r.currency)}, after ${money(r.fundedMinor, r.currency)}; hidden rows ${r.hiddenRows}; invariant ${r.invariantOk ? "ok" : "FAILED"}${r.sourceIsEarlier ? `; structure from ${r.sourceMonth}` : ""}`;
	}
	if (r.status === "MISSING_RATE")
		return `${head} no rate for ${r.missingRates.join(", ")} (not migrated)`;
	if (r.status === "ERROR") return `${head} ${r.warnings.join("; ")}`;
	return head;
}

function summarize(reports: readonly MigrationReport[], apply: boolean) {
	const by = (s: MigrationReport["status"]) =>
		reports.filter((r) => r.status === s);
	const moved = by("MIGRATED");
	const hidden = moved.filter((r) => r.hiddenRows > 0);
	const bad = moved.filter(
		(r) => !r.invariantOk || r.warnings.length > 0 || !r.funded,
	);
	console.log("");
	console.log(
		`${apply ? "Applied" : "Dry run (nothing written)"}: ${reports.length} people with old budgets`,
	);
	console.log(`  migrated:                  ${moved.length}`);
	console.log(`  already had a book:        ${by("HAS_BOOK").length}`);
	console.log(
		`  nothing worth moving:      ${by("NOTHING_TO_MIGRATE").length}`,
	);
	console.log(`  skipped, missing rate:     ${by("MISSING_RATE").length}`);
	console.log(`  errors:                    ${by("ERROR").length}`);
	console.log(
		`  hidden-rows reviews:       ${hidden.length} people, ${hidden.reduce((t, r) => t + r.hiddenRows, 0)} rows`,
	);
	console.log(`  not funded or invariant:   ${bad.length}`);
	const currencies = [
		...new Set(by("MISSING_RATE").flatMap((r) => r.missingRates)),
	].sort();
	if (currencies.length)
		console.log(`  currencies without a rate: ${currencies.join(", ")}`);
	for (const r of moved) {
		for (const l of r.left)
			console.log(
				`  ${r.userId}: left out ${l.categoryId ?? "global"} (${l.reason})`,
			);
		for (const w of r.warnings) console.log(`  ${r.userId}: warning: ${w}`);
	}
}

async function rollBack(target: string) {
	const out = await rollbackRun(db, target, { force: flag("--force") });
	if (out.blockedByFlag) {
		console.log(
			`Nothing rolled back: the envelope budget flag is ${out.blockedByFlag}, so the next read would move people in again. Turn it off first, or use --force.`,
		);
		return 2;
	}
	console.log(`Rolled back ${target}: removed ${out.removed.length} books`);
	for (const r of out.refused) {
		console.log(
			`  kept ${r.userId}: changed since the move (use --force to remove):`,
		);
		for (const c of r.changes) console.log(`    ${c}`);
	}
	for (const r of out.lost) {
		console.log(`  forced ${r.userId}, lost:`);
		for (const c of r.changes) console.log(`    ${c}`);
	}
	return out.refused.length > 0 ? 2 : 0;
}

async function main() {
	// stderr, so --json output stays parseable.
	console.error(`Database: ${maskUrl(connectionString as string)}`);
	const rollback = values("--rollback")[0];
	if (rollback) return rollBack(rollback);
	const apply = flag("--apply");
	const users = values("--user");
	const json = flag("--json");
	const { runId, reports } = await migrateUsers(
		db,
		{ apply, userIds: users.length ? users : undefined },
		json ? undefined : (r) => console.log(line(r)),
	);
	const attention = needsAttention(reports);
	if (json) {
		console.log(JSON.stringify({ runId, apply, attention, reports }, null, 2));
	} else {
		summarize(reports, apply);
		if (apply) console.log(`\nRun id (for --rollback): ${runId}`);
	}
	return attention > 0 ? 2 : 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
		await pool.end();
	});
