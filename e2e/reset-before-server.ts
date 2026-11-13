/**
 * Runs before `pnpm dev:test` starts, in both e2e modes (playwright.config.ts
 * prefixes the webServer command with it; E2EE D11 PR 9.2, docs/roadmap/
 * e2ee-d11-pr9.md critic round 2 item 1). Playwright starts the web server
 * before global setup, so by the time the seed runs the server has already
 * decided what it is: sealed (a fresh canary, instance key, sealing floor and
 * epoch) or not (nothing written). What the previous run left must not
 * disagree with that, or a sealed run followed by an unsealed one starts with
 * an epoch and no master key and refuses (`epoch_without_master_key`), and an
 * unsealed run followed by a sealed one would verify an old canary against a
 * new key.
 *
 * So this empties the database first: every public table, `app_settings`
 * included, and both key store tables, on the owner connection, behind the
 * e2e database check. `_prisma_migrations` stays. A database the migrations
 * never reached has no tables yet, which is fine: whatever is missing is
 * skipped. It never reads a value and prints counts only.
 */
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "./constants";
import { assertE2eDatabase } from "./db-guard";

const KEYSTORE_TABLES = ["user_data_key", "instance_text_key"] as const;

/** The quoted names of every table the reset empties and that exists now. */
async function tablesToEmpty(pool: Pool): Promise<string[]> {
	const { rows } = await pool.query<{ name: string }>(
		`SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables
		 WHERE (schemaname = 'public' AND tablename <> '_prisma_migrations')
		    OR (schemaname = 'keystore' AND tablename = ANY($1))
		 ORDER BY 1`,
		[KEYSTORE_TABLES],
	);
	return rows.map((r) => r.name);
}

export async function resetBeforeServer(url: string): Promise<number> {
	assertE2eDatabase(url);
	const pool = new Pool({ connectionString: url });
	try {
		const tables = await tablesToEmpty(pool);
		if (tables.length > 0)
			await pool.query(
				`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`,
			);
		return tables.length;
	} finally {
		await pool.end();
	}
}

resetBeforeServer(E2E_DATABASE_URL).then(
	(count) =>
		console.log(`E2E reset: ${count} tables emptied before the server`),
	(error: unknown) => {
		console.error(
			`E2E reset failed: ${error instanceof Error ? error.message : "unknown error"}`,
		);
		process.exit(1);
	},
);
