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
 * the `budget_book.name` default ("Personal"). The only escape is
 * `sealed-sweep.allow.json`: a file may leave plaintext in the one column its
 * entry names, and must still leave it there, so the list only shrinks
 * (sealed-suite.test.ts caps and checks it).
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { expect } from "vitest";
import { mappedColumns } from "~/server/crypto/fields";
import { adminDb } from "./pg-harness";

export { sealedSuite } from "./pg-harness";

/** A file that may leave plaintext, in one `table.column`, and why. */
export type SweepAllowance = { column: string; reason: string };

export const SWEEP_ALLOWED: Record<string, SweepAllowance> = JSON.parse(
	readFileSync(new URL("./sealed-sweep.allow.json", import.meta.url), "utf8"),
);

const plain = (table: string, column: string) =>
	`"${column}" IS NOT NULL AND NOT starts_with("${column}", E'\\x01k1:')
	${table === "budget_book" ? `AND "${column}" <> 'Personal'` : ""}`;

/** Every mapped cell holding plaintext now: `table.column` to row id to value. */
async function plaintextCells(): Promise<Map<string, Map<string, string>>> {
	const cells = new Map<string, Map<string, string>>();
	for (const [table, column] of mappedColumns()) {
		const rows = await adminDb.$queryRawUnsafe<{ id: string; v: string }[]>(
			`SELECT "id", "${column}" AS "v" FROM "${table}" WHERE ${plain(table, column)}`,
		);
		cells.set(`${table}.${column}`, new Map(rows.map((r) => [r.id, r.v])));
	}
	return cells;
}

/** Snapshots the plaintext an earlier file left; call in `beforeAll`. */
export async function startSweep(): Promise<() => Promise<void>> {
	const before = await plaintextCells();
	return async () => {
		const hits = new Map<string, number>();
		for (const [cell, rows] of await plaintextCells()) {
			const had = before.get(cell);
			let count = 0;
			for (const [id, value] of rows) if (had?.get(id) !== value) count++;
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
					.map(([cell, count]) => `${cell}: ${count}`)
					.join(", ")}`,
			);
		if (allowed && !hits.has(allowed))
			throw new Error(
				`${file} leaves no plaintext in ${allowed} now; remove it from src/test/sealed-sweep.allow.json`,
			);
	};
}
