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
 * - A snapshot of the seed (ids and cell hashes). Plaintext in a seeded cell
 *   that did not change is legacy and allowed. Plaintext in any other row, or
 *   in a seeded cell that changed, means something wrote text without sealing
 *   it (e2e/sealing-sweep.ts, run by global teardown in every shard).
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

/**
 * What the seed wrote in every table that holds mapped text: its row ids, and
 * a hash of each seeded text or JSON cell. A seeded cell may stay plaintext
 * (legacy), but one that changed and is still plaintext was written by an
 * update that did not seal it. Ids and md5 hashes only, never a value.
 */
export interface SeedSnapshot {
	ids: Record<string, string[]>;
	/** `table.column` to row id to md5 of the cell. */
	cells: Record<string, Record<string, string>>;
}

/**
 * Rows a spec inserts with SQL as the owner into a table that holds mapped
 * text (budget-sheets.spec.ts), so they are plaintext on purpose. Exact ids:
 * a row the server made has a cuid or uuid and is never skipped.
 */
export const SPEC_INSERTED_IDS: Record<string, string[]> = {
	shadow_profile: ["e2e_shadow_paz2"],
	shared_transaction: ["e2e_split_dinner"],
	asset_account: ["e2e_setup_visa"],
};

/** Saves the ids and cell hashes now in every mapped table: the seed. */
export async function snapshotSeed(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		const snapshot: SeedSnapshot = { ids: {}, cells: {} };
		for (const table of sealedTables()) {
			const { rows } = await pool.query<{ id: string }>(
				`SELECT "id"::text AS id FROM "${table}"`,
			);
			snapshot.ids[table] = rows.map((r) => r.id);
		}
		const cells: [string, string, string][] = [
			...mappedColumns().map(
				([t, c]) => [t, c, `"${c}"`] as [string, string, string],
			),
			...jsonColumns().map(
				([t, c]) => [t, c, `"${c}"::text`] as [string, string, string],
			),
		];
		for (const [table, column, expr] of cells) {
			const { rows } = await pool.query<{ id: string; h: string }>(
				`SELECT "id"::text AS id, md5(${expr}) AS h FROM "${table}"
				 WHERE "${column}" IS NOT NULL`,
			);
			snapshot.cells[`${table}.${column}`] = Object.fromEntries(
				rows.map((r) => [r.id, r.h]),
			);
		}
		mkdirSync(dirname(SEALING_SEED_IDS), { recursive: true });
		writeFileSync(SEALING_SEED_IDS, JSON.stringify(snapshot));
	} finally {
		await pool.end();
	}
}

/** The snapshot `snapshotSeed` saved. */
export function readSeedSnapshot(): SeedSnapshot {
	return JSON.parse(readFileSync(SEALING_SEED_IDS, "utf8"));
}
