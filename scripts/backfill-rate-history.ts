/**
 * Fills exchange_rate_history with the days before the app stored its own.
 *
 * The rate sync reads one file, rates.json in the syntheit/exchange-rates
 * repository, which that repository's bot commits on every refresh (about
 * ten months of commits at the time of writing). Each commit is a full
 * snapshot, so this reads the last commit of each day and stores that day's
 * rates, parsed the way the sidecar parses them. No other provider is used.
 * Days the app already stored (the sidecar writes one per sync) are never
 * overwritten.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-rate-history.ts          # dry run
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-rate-history.ts --apply  # write
 *
 * GITHUB_TOKEN is optional: the commit list is a handful of requests, well
 * inside the anonymous rate limit.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { CRYPTO_CURRENCIES } from "@retrospend/domain/currencies";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import {
	type CommitRef,
	type HistoryDayRow,
	historyRowsOf,
	lastCommitPerDay,
	type RatesFile,
} from "../src/server/services/rate-history-backfill";

const APPLY = process.argv.includes("--apply");
const REPO = "syntheit/exchange-rates";
const FILE = "rates.json";
const CONCURRENCY = 6;
const CHUNK = 5000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error("DATABASE_URL environment variable is required.");
	process.exit(1);
}

const pool = new Pool({ connectionString });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const headers: Record<string, string> = {
	Accept: "application/vnd.github+json",
	"User-Agent": "retrospend-rate-history-backfill",
	...(process.env.GITHUB_TOKEN
		? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
		: {}),
};

async function listCommits(): Promise<CommitRef[]> {
	const out: CommitRef[] = [];
	for (let page = 1; ; page++) {
		const res = await fetch(
			`https://api.github.com/repos/${REPO}/commits?path=${FILE}&per_page=100&page=${page}`,
			{ headers },
		);
		if (!res.ok) throw new Error(`commit list ${page}: HTTP ${res.status}`);
		const batch = (await res.json()) as {
			sha: string;
			commit: { committer: { date: string } };
		}[];
		if (batch.length === 0) return out;
		for (const c of batch)
			out.push({ sha: c.sha, date: c.commit.committer.date });
	}
}

async function fileAt(sha: string): Promise<RatesFile | null> {
	const res = await fetch(
		`https://raw.githubusercontent.com/${REPO}/${sha}/${FILE}`,
	);
	if (!res.ok) return null;
	try {
		return (await res.json()) as RatesFile;
	} catch {
		return null;
	}
}

async function main() {
	console.log(APPLY ? "Mode: APPLY" : "Mode: dry run (add --apply to write)");
	const commits = lastCommitPerDay(await listCommits());
	console.log(`Source commits, one per day: ${commits.length}`);

	const supported = new Set(Object.keys(CRYPTO_CURRENCIES));
	const files: (RatesFile | null)[] = new Array(commits.length).fill(null);
	let next = 0;
	const worker = async () => {
		while (next < commits.length) {
			const at = next++;
			const commit = commits[at];
			if (commit) files[at] = await fileAt(commit.sha);
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	// Two commits can carry the same file day. `commits` is newest first, so
	// walking it from the end lets the newer commit overwrite the older.
	const byKey = new Map<string, HistoryDayRow>();
	let read = 0;
	for (let at = files.length - 1; at >= 0; at--) {
		const file = files[at];
		if (!file) continue;
		read++;
		for (const row of historyRowsOf(file, supported))
			byKey.set(`${row.day}|${row.currency}|${row.type}`, row);
	}
	const rows = [...byKey.values()];
	const days = new Set(rows.map((r) => r.day));
	console.log(
		`Snapshots read: ${read}, days: ${days.size}, rows: ${rows.length}`,
	);

	if (!APPLY) return;
	let written = 0;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const batch = await db.exchangeRateHistory.createMany({
			data: rows.slice(i, i + CHUNK).map((r) => ({
				date: new Date(`${r.day}T00:00:00Z`),
				currency: r.currency,
				type: r.type,
				rate: r.rate.toString(),
			})),
			skipDuplicates: true,
		});
		written += batch.count;
	}
	console.log(`Written: ${written} (the rest were already stored)`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
		await pool.end();
	});
