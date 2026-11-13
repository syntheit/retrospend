/**
 * The sealed pg suite (E2EE D11 PR 4.4, docs/roadmap/e2ee-d11-pr4.md section
 * 7): `pnpm test:pg:sealed` runs the pg files with sealing on, a master key
 * and the field encryption epoch set (pg-env.ts), except those listed in
 * sealed-suite.exclude.json, which set a master key, sealing or the epoch
 * themselves. Tests seed user rows through `fixtureDb` (fixture-db.ts). The
 * sweep here is its guard: after each file, any mapped cell (from
 * `mappedColumns()`, so a column added later is covered) that holds
 * plaintext it did not hold when the file started, a new row or a new value,
 * fails the file with its table, column and count.
 *
 * Plaintext is any text, "" too, that is not sealed; the one exception is
 * the `budget_book.name` default ("Personal"). A JSON body cell
 * (`jsonColumns()`) holds plaintext unless it is null or a `{ sealed }`
 * envelope. A leaves cell (the audit log's `changes`) is swept string by
 * string: a string at a declared leaf path must be sealed, and any other
 * string must be classified as no text (json-no-text.ts), so a writer that
 * puts a new text field into `changes` fails the file as `<table>.<column>
 * (undeclared leaf)` until the field is declared or listed with its reason.
 * The only escape is `sealed-sweep.allow.json`: a file may leave plaintext in the one column its
 * entry names, and must still leave it there, so the list only shrinks
 * (sealed-suite.test.ts caps and checks it).
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { expect } from "vitest";
import {
	type JsonCell,
	jsonColumns,
	mappedColumns,
} from "~/server/crypto/fields";
import {
	plainBodySql,
	plainTextSql,
	textLeaves,
} from "~/server/crypto/plaintext-sql";
import { adminDb } from "./pg-harness";

export { sealedSuite } from "./pg-harness";

/** A file that may leave plaintext, in one `table.column`, and why. */
export type SweepAllowance = { column: string; reason: string };

export const SWEEP_ALLOWED: Record<string, SweepAllowance> = JSON.parse(
	readFileSync(new URL("./sealed-sweep.allow.json", import.meta.url), "utf8"),
);

/**
 * The leaves of a leaves cell that leave plaintext: a declared leaf (or one
 * kept as its source cell's ciphertext) that is not sealed, and, as a cell
 * of its own, any string nobody classified. Keyed by row id and path.
 */
async function sweepLeaves(
	table: string,
	column: string,
	cell: Extract<JsonCell, { mode: "leaves" }>,
	cells: Map<string, Map<string, string>>,
): Promise<void> {
	if (table !== "audit_log_entry" || column !== "changes")
		throw new Error(`The sweep has no leaf rules for ${table}.${column}`);
	const rows = await adminDb.$queryRawUnsafe<{ id: string; v: unknown }[]>(
		`SELECT "id", "${column}" AS "v" FROM "${table}"
		 WHERE "${column}" IS NOT NULL AND jsonb_typeof("${column}") = 'object'`,
	);
	const plain = new Map<string, string>();
	const undeclared = new Map<string, string>();
	for (const { id, v } of rows)
		for (const { path, text, state } of textLeaves(v, cell)) {
			const at = `${id}#${path.join(".")}`;
			if (state === "undeclared") undeclared.set(at, text);
			// A legacy copy is only listed apart by verify-sealing; the sealed suite
			// seeds sealed sources, so a plaintext copy here is still a failure.
			else if (state !== "sealed") plain.set(at, text);
		}
	cells.set(`${table}.${column}`, plain);
	cells.set(`${table}.${column} (undeclared leaf)`, undeclared);
}

/** Every mapped cell holding plaintext now: `table.column` to row id to value. */
async function plaintextCells(): Promise<Map<string, Map<string, string>>> {
	const cells = new Map<string, Map<string, string>>();
	const sweep = async (table: string, column: string, where: string) => {
		const rows = await adminDb.$queryRawUnsafe<{ id: string; v: string }[]>(
			`SELECT "id", "${column}"::text AS "v" FROM "${table}" WHERE ${where}`,
		);
		cells.set(`${table}.${column}`, new Map(rows.map((r) => [r.id, r.v])));
	};
	for (const [table, column] of mappedColumns())
		await sweep(table, column, plainTextSql(table, column));
	for (const [table, column, cell] of jsonColumns())
		if (cell.mode === "body") await sweep(table, column, plainBodySql(column));
		else await sweepLeaves(table, column, cell, cells);
	return cells;
}

/** Snapshots the plaintext an earlier file left; call in `beforeAll`. */
export async function startSweep(): Promise<() => Promise<void>> {
	const before = await plaintextCells();
	return async () => {
		const hits = new Map<string, number>();
		// Where a JSON leaf was left: its path, never its row or its text.
		const paths = new Map<string, Set<string>>();
		for (const [cell, rows] of await plaintextCells()) {
			const had = before.get(cell);
			let count = 0;
			for (const [id, value] of rows)
				if (had?.get(id) !== value) {
					count++;
					if (id.includes("#"))
						paths.set(
							cell,
							(paths.get(cell) ?? new Set()).add(id.slice(id.indexOf("#") + 1)),
						);
				}
			if (count > 0) hits.set(cell, count);
		}
		const file = relative(process.cwd(), expect.getState().testPath ?? "");
		const allowed = Object.hasOwn(SWEEP_ALLOWED, file)
			? SWEEP_ALLOWED[file]?.column
			: undefined;
		const refused = [...hits].filter(([cell]) => cell !== allowed);
		if (refused.length > 0)
			throw new Error(
				`Plaintext left in mapped columns with sealing on: ${refused
					.map(
						([cell, count]) =>
							`${cell}: ${count}${paths.has(cell) ? ` at ${[...(paths.get(cell) ?? [])].join(", ")}` : ""}`,
					)
					.join(", ")}`,
			);
		if (allowed && !hits.has(allowed))
			throw new Error(
				`${file} leaves no plaintext in ${allowed} now; remove it from src/test/sealed-sweep.allow.json`,
			);
	};
}
