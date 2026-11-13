/**
 * The database sweep of a sealed e2e run (E2E_SEALED=1, E2EE D11 PR 9.2,
 * plan docs/roadmap/e2ee-d11-pr9.md section 6): after the whole suite, every
 * mapped text cell, JSON body and audit leaf must be sealed, except what the
 * seed wrote and nothing changed since. It runs from global teardown
 * (global-teardown.ts), so every shard sweeps its own database, whatever
 * specs it held. It shares its plaintext rules with scripts/verify-sealing.ts
 * through src/server/crypto/plaintext-sql.ts.
 *
 * What counts as a finding:
 * - a row the seed did not write (and no spec inserted with SQL, see
 *   SPEC_INSERTED_IDS) that holds plaintext;
 * - a seeded cell whose hash differs from the seed snapshot and that is still
 *   plaintext: an update wrote it and did not seal it.
 * An audit leaf that copies a plaintext source (`legacy_copy`, a payment
 * confirm's `previous`) is legacy text, not a finding.
 *
 * Findings are table, column, counts and leaf paths, never a value or an id.
 */
import type { Pool } from "pg";
import { jsonColumns, mappedColumns } from "~/server/crypto/fields";
import {
	plainBodySql,
	plainTextSql,
	textLeaves,
} from "~/server/crypto/plaintext-sql";
import { type SeedSnapshot, SPEC_INSERTED_IDS } from "./sealing-seed";

export async function sweepSealing(
	pool: Pool,
	snapshot: SeedSnapshot,
): Promise<string[]> {
	const found: string[] = [];
	const seeded = (table: string) => snapshot.ids[table] ?? [];
	const skipped = (table: string) => [
		...seeded(table),
		...(SPEC_INSERTED_IDS[table] ?? []),
	];

	/** A text or JSON body cell, by its SQL predicate for plaintext. */
	const sweepCell = async (
		table: string,
		column: string,
		plain: string,
		hash: string,
	) => {
		const fresh = await pool.query<{ n: string }>(
			`SELECT count(*) AS n FROM "${table}"
			 WHERE (${plain}) AND "id"::text <> ALL($1::text[])`,
			[skipped(table)],
		);
		if (Number(fresh.rows[0]?.n) > 0)
			found.push(`${table}.${column}: ${fresh.rows[0]?.n} new rows`);
		const old = await pool.query<{ id: string; h: string }>(
			`SELECT "id"::text AS id, md5(${hash}) AS h FROM "${table}"
			 WHERE (${plain}) AND "id"::text = ANY($1::text[])`,
			[seeded(table)],
		);
		const was = snapshot.cells[`${table}.${column}`] ?? {};
		const changed = old.rows.filter((r) => was[r.id] !== r.h).length;
		if (changed > 0)
			found.push(`${table}.${column}: ${changed} seeded cells changed`);
	};

	for (const [table, column] of mappedColumns())
		await sweepCell(table, column, plainTextSql(table, column), `"${column}"`);
	for (const [table, column, cell] of jsonColumns()) {
		if (cell.mode === "body") {
			await sweepCell(table, column, plainBodySql(column), `"${column}"::text`);
			continue;
		}
		// A leaves cell is read leaf by leaf in the app: the rows the seed did not
		// write, and the seeded rows whose cell changed.
		const { rows } = await pool.query<{
			id: string;
			v: unknown;
			h: string;
		}>(
			`SELECT "id"::text AS id, "${column}" AS v, md5("${column}"::text) AS h
			 FROM "${table}"
			 WHERE "${column}" IS NOT NULL AND jsonb_typeof("${column}") = 'object'
			   AND "id"::text <> ALL($1::text[])`,
			[SPEC_INSERTED_IDS[table] ?? []],
		);
		const was = snapshot.cells[`${table}.${column}`] ?? {};
		const isSeeded = new Set(seeded(table));
		const bad = new Set<string>();
		for (const { id, v, h } of rows) {
			if (isSeeded.has(id) && was[id] === h) continue;
			for (const { path, state } of textLeaves(v, cell))
				if (state !== "sealed" && state !== "legacy_copy")
					bad.add(`${isSeeded.has(id) ? "seeded " : ""}${path.join(".")}`);
		}
		if (bad.size > 0)
			found.push(`${table}.${column}: leaves at ${[...bad].join(", ")}`);
	}
	return found;
}
