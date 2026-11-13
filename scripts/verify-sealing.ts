/**
 * Read-only check of what is sealed in a database (E2EE D11 PR 9.1, plan
 * docs/roadmap/e2ee-d11-pr9.md sections 3 and 4). It reports:
 *   - the field encryption epoch, the sealing floor (stored, and this build's)
 *     and whether the instance key marker is set;
 *   - contact hash coverage: ghost and guest rows with an address, with a
 *     hash, and with an address but no hash;
 *   - per mapped text column and per JSON cell (`mappedColumns()` and
 *     `jsonColumns()`): rows holding a value, sealed, and plaintext;
 *   - once the epoch is set, plaintext cells in rows created after it, and in
 *     rows created before it but updated after it. Both must be 0 and fail the
 *     run. A legacy row that was only touched for another reason (a changed
 *     amount) after the epoch still holds its old plaintext title in mixed
 *     mode, so `--created-only` reports that group without failing on it;
 *   - legacy copies: leaves of an audit entry's `changes.previous` (a payment
 *     confirm keeps its source cells' own text) that are plaintext because
 *     their source is, until the D12 reseal. They are listed apart, count in
 *     the baseline, and never in the two invariants above;
 *   - tables with no `createdAt` or `updatedAt` (the audit log's `timestamp`
 *     counts as `createdAt`), which only the baseline
 *     covers (plaintext never rises above what an earlier run printed).
 *
 * The session is read only: `default_transaction_read_only` is on and the work
 * runs in `BEGIN READ ONLY`, so a write fails. It prints counts and table and
 * column names only, never a value, an address or an id. It needs a role that
 * can read every row (the owner role), or row-level security hides rows.
 *
 * The plaintext rules are the sealed pg suite's (plaintext-sql.ts).
 *
 * Exit code: 0 when nothing is wrong, 1 on a violation, 2 when it cannot run.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/verify-sealing.ts [--created-only]
 */
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { jsonColumns, mappedColumns } from "../src/server/crypto/fields";
import {
	hasBodySql,
	hasTextSql,
	plainBodySql,
	plainTextSql,
	textLeaves,
} from "../src/server/crypto/plaintext-sql";
import { SEALING_FLOOR } from "../src/server/crypto/release";

type Sql = Pick<PoolClient, "query">;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const EPOCH_SQL = `(SELECT "fieldEncryptionSince" FROM "app_settings" WHERE "id" = 'app_settings_singleton')`;

export interface CellReport {
	cell: string;
	/** Cells holding a value; null when the table or column does not exist. */
	rows: number | null;
	sealed: number;
	plaintext: number;
	/** Plaintext in rows created after the epoch. */
	createdAfter: number;
	/** Plaintext in rows created before the epoch and updated after it. */
	updatedAfter: number;
	/** The table has no createdAt or updatedAt, so only the baseline applies. */
	noTimestamps: boolean;
	/**
	 * Plaintext leaves that copy a plaintext source cell (a payment confirm's
	 * `previous`). They are in `plaintext` (the baseline rule) but never in
	 * `createdAfter` or `updatedAfter`: the source is legacy plaintext too.
	 */
	legacyCopies: number;
}

export interface ContactReport {
	table: string;
	withAddress: number;
	withHash: number;
	addressWithoutHash: number;
}

export interface SealingReport {
	epoch: string | null;
	storedFloor: number | null;
	buildFloor: number;
	instanceKeyMarker: boolean;
	contacts: ContactReport[];
	cells: CellReport[];
}

/** Opens a read-only session on one connection: a write fails in it. */
export async function openReadOnlySession(pool: Pool): Promise<PoolClient> {
	const client = await pool.connect();
	try {
		await client.query("SET default_transaction_read_only = on");
		await client.query("BEGIN READ ONLY");
	} catch (error) {
		client.release();
		throw error;
	}
	return client;
}

/**
 * The columns that date a row: when it was created (`createdAt`, or the audit
 * log's `timestamp`, which is never updated) and when it was last updated.
 */
async function timestamps(client: Sql, table: string) {
	const { rows } = await client.query<{ column_name: string }>(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = $1
		   AND column_name IN ('createdAt', 'updatedAt', 'timestamp')
		   AND data_type LIKE 'timestamp%'`,
		[table],
	);
	const has = new Set(rows.map((r) => r.column_name));
	return {
		created: has.has("createdAt")
			? "createdAt"
			: has.has("timestamp")
				? "timestamp"
				: null,
		updated: has.has("updatedAt"),
	};
}
type Timestamps = Awaited<ReturnType<typeof timestamps>>;

async function columnExists(client: Sql, table: string, column: string) {
	const { rowCount } = await client.query(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
		[table, column],
	);
	return rowCount === 1;
}

const emptyCell = (cell: string, noTimestamps = false): CellReport => ({
	cell,
	rows: null,
	sealed: 0,
	plaintext: 0,
	createdAfter: 0,
	updatedAfter: 0,
	noTimestamps,
	legacyCopies: 0,
});

/** The row filters "created after the epoch" and "only updated after it". */
function afterFilters(ts: Timestamps) {
	const created = ts.created ? `"${ts.created}" > ${EPOCH_SQL}` : "false";
	const updated = ts.updated
		? `"updatedAt" > ${EPOCH_SQL} AND NOT COALESCE(${created}, false)`
		: "false";
	return { created, updated };
}

/** A text cell or a JSON body cell, counted in SQL. */
async function countCell(
	client: Sql,
	table: string,
	column: string,
	sql: { has: string; plain: string },
): Promise<CellReport> {
	const cell = `${table}.${column}`;
	const ts = await timestamps(client, table);
	const noTimestamps = ts.created === null && !ts.updated;
	if (!(await columnExists(client, table, column)))
		return emptyCell(cell, noTimestamps);
	const f = afterFilters(ts);
	const { rows } = await client.query<Record<string, string>>(
		`SELECT count(*) FILTER (WHERE ${sql.has}) AS rows,
			count(*) FILTER (WHERE ${sql.plain}) AS plaintext,
			count(*) FILTER (WHERE (${sql.plain}) AND (${f.created})) AS created,
			count(*) FILTER (WHERE (${sql.plain}) AND (${f.updated})) AS updated
		 FROM ${quote(table)}`,
	);
	const r = rows[0] ?? {};
	const total = Number(r.rows ?? 0);
	const plaintext = Number(r.plaintext ?? 0);
	return {
		cell,
		rows: total,
		sealed: total - plaintext,
		plaintext,
		createdAfter: Number(r.created ?? 0),
		updatedAfter: Number(r.updated ?? 0),
		noTimestamps,
		legacyCopies: 0,
	};
}

/** A leaves cell (the audit log's `changes`), read leaf by leaf in the app. */
async function countLeaves(
	client: Sql,
	table: string,
	column: string,
	cell: Parameters<typeof textLeaves>[1],
): Promise<CellReport[]> {
	const name = `${table}.${column}`;
	const ts = await timestamps(client, table);
	const noTimestamps = ts.created === null && !ts.updated;
	if (!(await columnExists(client, table, column)))
		return [emptyCell(name, noTimestamps)];
	const f = afterFilters(ts);
	const { rows } = await client.query<{
		v: unknown;
		created: boolean | null;
		updated: boolean | null;
	}>(
		`SELECT ${quote(column)} AS v, (${f.created}) AS created, (${f.updated}) AS updated
		 FROM ${quote(table)}
		 WHERE ${quote(column)} IS NOT NULL AND jsonb_typeof(${quote(column)}) = 'object'`,
	);
	const text = emptyCell(name, noTimestamps);
	const undeclared = emptyCell(`${name} (undeclared leaf)`, noTimestamps);
	text.rows = rows.length;
	undeclared.rows = rows.length;
	for (const row of rows)
		for (const { state } of textLeaves(row.v, cell)) {
			const target = state === "undeclared" ? undeclared : text;
			if (state === "sealed") text.sealed++;
			else if (state === "legacy_copy") {
				// In the baseline, never "written after the epoch".
				text.plaintext++;
				text.legacyCopies++;
			} else {
				target.plaintext++;
				if (row.created) target.createdAfter++;
				else if (row.updated) target.updatedAfter++;
			}
		}
	return [text, undeclared];
}

const CONTACT_TABLES = ["shadow_profile", "guest_session"] as const;

async function contactCoverage(client: Sql): Promise<ContactReport[]> {
	const out: ContactReport[] = [];
	for (const table of CONTACT_TABLES) {
		const { rows } = await client.query<Record<string, string>>(
			`SELECT count(*) FILTER (WHERE "email" IS NOT NULL) AS addr,
				count(*) FILTER (WHERE "emailHash" IS NOT NULL) AS hashed,
				count(*) FILTER (WHERE "email" IS NOT NULL AND "emailHash" IS NULL) AS missing
			 FROM ${quote(table)}`,
		);
		out.push({
			table,
			withAddress: Number(rows[0]?.addr ?? 0),
			withHash: Number(rows[0]?.hashed ?? 0),
			addressWithoutHash: Number(rows[0]?.missing ?? 0),
		});
	}
	return out;
}

/** Reads everything the report needs on one read-only connection. */
export async function verifySealing(client: Sql): Promise<SealingReport> {
	const { rows } = await client.query<{
		epoch: string | null;
		floor: number | null;
		marker: boolean;
	}>(
		`SELECT to_char("fieldEncryptionSince", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS epoch,
			"sealingFloor" AS floor, "instanceKeySince" IS NOT NULL AS marker
		 FROM "app_settings" WHERE "id" = 'app_settings_singleton'`,
	);
	const cells: CellReport[] = [];
	for (const [table, column] of mappedColumns())
		cells.push(
			await countCell(client, table, column, {
				has: hasTextSql(column),
				plain: plainTextSql(table, column),
			}),
		);
	for (const [table, column, cell] of jsonColumns())
		if (cell.mode === "body")
			cells.push(
				await countCell(client, table, column, {
					has: hasBodySql(column),
					plain: plainBodySql(column),
				}),
			);
		else cells.push(...(await countLeaves(client, table, column, cell)));
	return {
		epoch: rows[0]?.epoch ?? null,
		storedFloor: rows[0]?.floor ?? null,
		buildFloor: SEALING_FLOOR,
		instanceKeyMarker: rows[0]?.marker === true,
		contacts: await contactCoverage(client),
		cells,
	};
}

export interface Verdict {
	/** Plaintext in rows created after the epoch, and (strict) updated after it. */
	violations: number;
	lines: string[];
}

export function judge(
	report: SealingReport,
	options: { createdOnly: boolean },
): Verdict {
	if (report.epoch === null) return { violations: 0, lines: [] };
	let violations = 0;
	const lines: string[] = [];
	for (const c of report.cells) {
		const bad = c.createdAfter + (options.createdOnly ? 0 : c.updatedAfter);
		violations += bad;
		if (bad > 0)
			lines.push(
				`${c.cell}: ${c.createdAfter} created after the epoch, ${c.updatedAfter} updated after it`,
			);
	}
	return { violations, lines };
}

const pad = (rows: string[][]) => {
	const width = (rows[0] ?? []).map((_, i) =>
		Math.max(...rows.map((r) => r[i]?.length ?? 0)),
	);
	return rows.map((r) =>
		r
			.map((cell, i) =>
				i === 0 ? cell.padEnd(width[0] ?? 0) : cell.padStart(width[i] ?? 0),
			)
			.join("  "),
	);
};

/** The text to print: counts and names only. */
export function formatReport(
	report: SealingReport,
	verdict: Verdict,
	options: { createdOnly: boolean },
): string {
	const head = [
		`Field encryption epoch: ${report.epoch ?? "not set"}`,
		`Sealing floor: stored ${report.storedFloor ?? "none"}, this build ${report.buildFloor}`,
		`Instance key marker: ${report.instanceKeyMarker ? "set" : "not set"}`,
		"",
		...pad([
			["contacts", "with address", "with hash", "address without hash"],
			...report.contacts.map((c) => [
				c.table,
				String(c.withAddress),
				String(c.withHash),
				String(c.addressWithoutHash),
			]),
		]),
		"",
	];
	const cells = pad([
		[
			"table.column",
			"rows",
			"sealed",
			"plaintext",
			"created after",
			"updated after",
		],
		...report.cells.map((c) => [
			c.cell,
			c.rows === null ? "missing" : String(c.rows),
			String(c.sealed),
			String(c.plaintext),
			report.epoch === null ? "-" : String(c.createdAfter),
			report.epoch === null ? "-" : String(c.updatedAfter),
		]),
	]);
	const noTs = report.cells.filter((c) => c.noTimestamps).map((c) => c.cell);
	const legacy = report.cells.filter((c) => c.legacyCopies > 0);
	const tail = [
		"",
		`Tables with no createdAt or updatedAt (baseline only): ${noTs.length > 0 ? noTs.join(", ") : "none"}`,
		report.epoch === null
			? "No epoch yet: nothing was sealed, so these counts are the baseline."
			: verdict.violations === 0
				? `Plaintext written after the epoch: 0${options.createdOnly ? " (created only)" : ""}`
				: `Plaintext written after the epoch: ${verdict.violations}`,
		...verdict.lines.map((l) => `  ${l}`),
		`Legacy copies (plaintext copied from a plaintext source until the reseal, in the baseline, not in the rule above): ${legacy.reduce((n, c) => n + c.legacyCopies, 0)}${legacy.length > 0 ? ` in ${legacy.map((c) => c.cell).join(", ")}` : ""}`,
		report.contacts.some((c) => c.addressWithoutHash > 0)
			? "Contacts with an address and no hash: restart with DATA_KEYS_WRITE on to fill them."
			: "",
	];
	return [...head, ...cells, ...tail]
		.filter((l, i, a) => l !== "" || a[i - 1] !== "")
		.join("\n");
}

/** Runs the check on a read-only session and returns the exit code. */
export async function runVerify(
	pool: Pool,
	options: { createdOnly: boolean },
	log: (text: string) => void,
): Promise<number> {
	const client = await openReadOnlySession(pool);
	try {
		const report = await verifySealing(client);
		const verdict = judge(report, options);
		log(formatReport(report, verdict, options));
		return verdict.violations > 0 ? 1 : 0;
	} finally {
		await client.query("ROLLBACK").catch(() => undefined);
		client.release();
	}
}

async function main() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error("DATABASE_URL environment variable is required.");
		process.exit(2);
	}
	const pool = new Pool({ connectionString });
	try {
		const createdOnly = process.argv.slice(2).includes("--created-only");
		process.exitCode = await runVerify(pool, { createdOnly }, console.log);
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error: unknown) => {
		// A database error can quote a value; print its code only.
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code: unknown }).code)
				: "unknown";
		console.error(`Verify failed (${code})`);
		process.exit(2);
	});
