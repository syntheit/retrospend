/**
 * Read-only scan for user text the app would now refuse (E2EE lane D4b).
 * Every declared user-text column is counted for rows that hold a C0 control
 * character other than tab, line feed and carriage return, rows that start
 * with U+0001 (the marker of a field-encrypted value), and rows that hold
 * U+FFFD. The last is information only: Postgres cannot store a lone
 * surrogate (the driver turns one into U+FFFD on write), so U+FFFD is where
 * a lone surrogate would show up.
 *
 * Prints counts per table and column. It never prints a value or a user id,
 * and it runs in a read-only transaction. It needs a role that can read every
 * row (the owner role, as the other scripts use), or row-level security hides
 * rows from the counts.
 *
 * With `--fail` it is the gate before the first at-rest encryption backfill
 * (D11): it exits 1 when any column holds a C0 control character or a value
 * that starts with U+0001. After the first sealed write, sealed values start
 * with U+0001 by design, so the gate only means something before that.
 * U+FFFD is information only and never fails the gate.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/scan-control-chars.ts [--fail]
 */
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";

/** The database columns that hold declared user text (see user-text-capacity.pg.test.ts). */
export const USER_TEXT_COLUMNS: ReadonlyArray<readonly [string, string]> = [
	["apikey", "name"],
	["asset_account", "name"],
	["billing_period", "label"],
	["budget_book", "name"],
	["budget_movement", "note"],
	["category", "name"],
	["envelope", "name"],
	["envelope_change", "previousName"],
	["envelope_group", "name"],
	["error_report", "message"],
	["error_report", "stack"],
	["expense", "description"],
	["expense", "location"],
	["expense", "title"],
	["export_job", "fileName"],
	["feedback", "adminNote"],
	["feedback", "message"],
	["fix_request", "message"],
	["fix_request", "reply"],
	["guest_session", "name"],
	["import_job", "fileName"],
	["income_rule", "matchTitle"],
	["income_rule", "name"],
	["payment", "note"],
	["payment", "paymentMethod"],
	["payment_method", "identifier"],
	["payment_method", "label"],
	["project", "description"],
	["project", "name"],
	["push_device", "deviceName"],
	["recurring_template", "name"],
	["recurring_template", "paymentSource"],
	["recurring_template", "websiteUrl"],
	["settlement", "note"],
	["settlement", "paymentMethod"],
	["settlement", "rejectedReason"],
	["shadow_profile", "name"],
	["shared_transaction", "description"],
	["shared_transaction", "notes"],
	["shared_transaction", "receiptUrl"],
	["split_participant", "rejectionReason"],
	["transfer", "note"],
	["user", "name"],
	["webhook", "name"],
	["wealth_transfer", "note"],
];

export type ColumnCount = {
	table: string;
	column: string;
	/** Rows in the table; null when the table or column does not exist. */
	rows: number | null;
	controls: number;
	startsWithU0001: number;
	replacement: number;
};

// C0 controls except tab (09), line feed (0a) and carriage return (0d).
const CONTROLS = "[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f]";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Counts one column. The names come from the list above, never from input. */
async function countColumn(
	client: Pick<PoolClient, "query">,
	table: string,
	column: string,
): Promise<ColumnCount> {
	const exists = await client.query(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
		[table, column],
	);
	if (exists.rowCount === 0)
		return {
			table,
			column,
			rows: null,
			controls: 0,
			startsWithU0001: 0,
			replacement: 0,
		};
	const c = quote(column);
	const { rows } = await client.query<{
		total: string;
		controls: string;
		marker: string;
		replacement: string;
	}>(
		`SELECT count(*) AS total,
			count(*) FILTER (WHERE ${c} ~ '${CONTROLS}') AS controls,
			count(*) FILTER (WHERE left(${c}, 1) = chr(1)) AS marker,
			count(*) FILTER (WHERE position(chr(65533) in ${c}) > 0) AS replacement
		 FROM ${quote(table)}`,
	);
	const r = rows[0];
	return {
		table,
		column,
		rows: Number(r?.total ?? 0),
		controls: Number(r?.controls ?? 0),
		startsWithU0001: Number(r?.marker ?? 0),
		replacement: Number(r?.replacement ?? 0),
	};
}

/** Counts every user-text column in one read-only transaction. */
export async function scanControlChars(pool: Pool): Promise<ColumnCount[]> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN READ ONLY");
		const out: ColumnCount[] = [];
		for (const [table, column] of USER_TEXT_COLUMNS)
			out.push(await countColumn(client, table, column));
		return out;
	} finally {
		await client.query("ROLLBACK").catch(() => undefined);
		client.release();
	}
}

export function formatScan(counts: readonly ColumnCount[]): string {
	const head = ["table.column", "rows", "controls", "starts U+0001", "U+FFFD"];
	const lines = counts.map((c) => [
		`${c.table}.${c.column}`,
		c.rows === null ? "missing" : String(c.rows),
		String(c.controls),
		String(c.startsWithU0001),
		String(c.replacement),
	]);
	const width = head.map((h, i) =>
		Math.max(h.length, ...lines.map((l) => l[i]?.length ?? 0)),
	);
	const row = (cells: string[]) =>
		cells
			.map((cell, i) =>
				i === 0 ? cell.padEnd(width[0] ?? 0) : cell.padStart(width[i] ?? 0),
			)
			.join("  ");
	const dirty = counts.filter((c) => c.controls > 0 || c.startsWithU0001 > 0);
	return [
		row(head),
		...lines.map(row),
		"",
		`Columns with rows to clean: ${dirty.length}`,
		`Rows with a control character: ${counts.reduce((n, c) => n + c.controls, 0)}`,
		`Rows starting with U+0001: ${counts.reduce((n, c) => n + c.startsWithU0001, 0)}`,
	].join("\n");
}

/** True when the gate must fail: a value starts with U+0001 or holds a control. */
export function hasBlockingRows(counts: readonly ColumnCount[]): boolean {
	return counts.some((c) => c.controls > 0 || c.startsWithU0001 > 0);
}

/**
 * Scans, prints the table to `log`, and returns the process exit code: 1 when
 * `fail` is set and the scan found a blocking row, otherwise 0.
 */
export async function runScan(
	pool: Pool,
	options: { fail: boolean },
	log: (text: string) => void,
): Promise<number> {
	const counts = await scanControlChars(pool);
	log(formatScan(counts));
	if (!options.fail || !hasBlockingRows(counts)) return 0;
	log("Blocked: clean these rows before turning encryption on.");
	return 1;
}

async function main() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error("DATABASE_URL environment variable is required.");
		process.exit(1);
	}
	const pool = new Pool({ connectionString });
	try {
		const fail = process.argv.slice(2).includes("--fail");
		process.exitCode = await runScan(pool, { fail }, console.log);
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error: unknown) => {
		console.error(
			`Scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
		);
		process.exit(1);
	});
