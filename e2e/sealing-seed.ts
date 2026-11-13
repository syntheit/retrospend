/**
 * What a sealed e2e run (E2E_SEALED=1) does around the seed, and how the
 * sealing spec finds what was not sealed on purpose (E2EE D11 PR 9.2, plan
 * docs/roadmap/e2ee-d11-pr9.md section 6).
 *
 * The seed writes plaintext straight to Postgres, so a sealed run is mixed
 * mode the way a real instance is on the first start with the flag on: legacy
 * rows read as plaintext, rows the server writes are sealed. Two things follow:
 *
 * - Category name indexes. Once names are sealed the name index keeps them
 *   unique, and the start check refuses a database whose categories lack one
 *   (`category_index_missing`). The real runbook runs
 *   scripts/backfill-category-name-index.ts before the flag, so the seed does
 *   the same: it runs that script on the seeded rows (indexSeedCategories),
 *   which also makes each seeded user's data key the way a real instance's
 *   users have one before the first sealed write. The other choice, asserting
 *   the null-index fallback, would test a state the runbook tells the owner to
 *   leave before the flag goes on.
 * - A snapshot of the ids the seed wrote in every table that holds mapped
 *   text. Plaintext in those rows is legacy and allowed. Plaintext in any
 *   other row means something wrote text without sealing it
 *   (e2e/flows/zz-sealing.spec.ts).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";
import { jsonColumns, mappedColumns } from "~/server/crypto/fields";
import {
	E2E_AUTH_SECRET,
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	E2E_MASTER_KEY,
	SEALING_SEED_IDS,
} from "./constants";

/** Every table with a mapped text column or a mapped JSON cell. */
export function sealedTables(): string[] {
	return [
		...new Set([
			...mappedColumns().map(([table]) => table),
			...jsonColumns().map(([table]) => table),
		]),
	];
}

/**
 * Runs the category name index backfill on the seeded database, as the
 * runbook does before the flag. Prints the script's counts, never a name.
 */
export function indexSeedCategories(): void {
	const out = execFileSync(
		"pnpm",
		["exec", "tsx", "scripts/backfill-category-name-index.ts", "--apply"],
		{
			env: {
				...process.env,
				DATABASE_URL: E2E_DATABASE_URL,
				AUTH_SECRET: E2E_AUTH_SECRET,
				PUBLIC_URL: E2E_BASE_URL,
				NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
				SIDECAR_URL: "http://127.0.0.1:9",
				// Like the runbook: the flag is still off when the backfill runs.
				DATA_KEYS_WRITE: "false",
				DATA_MASTER_KEY: E2E_MASTER_KEY,
			},
			encoding: "utf8",
		},
	);
	// The script prints counts; Prisma's query log shares the stream.
	console.log(
		out
			.split("\n")
			.filter((line) =>
				/^(Categories|Updated|Conflicts|Stale|Users skipped)/.test(line),
			)
			.join("\n"),
	);
}

/** Saves the ids now in every mapped table: the rows the seed made. */
export async function snapshotSeedIds(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		const ids: Record<string, string[]> = {};
		for (const table of sealedTables()) {
			const { rows } = await pool.query<{ id: string }>(
				`SELECT "id" FROM "${table}"`,
			);
			ids[table] = rows.map((r) => r.id);
		}
		mkdirSync(dirname(SEALING_SEED_IDS), { recursive: true });
		writeFileSync(SEALING_SEED_IDS, JSON.stringify(ids));
	} finally {
		await pool.end();
	}
}

/** The ids `snapshotSeedIds` saved, by table. */
export function readSeedIds(): Record<string, string[]> {
	return JSON.parse(readFileSync(SEALING_SEED_IDS, "utf8"));
}
