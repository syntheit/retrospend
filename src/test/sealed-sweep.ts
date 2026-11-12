/**
 * The sealed pg suite (E2EE D11 PR 4.4, docs/roadmap/e2ee-d11-pr4.md section
 * 7): `pnpm test:pg:sealed` runs the pg files with sealing on, a master key
 * and the field encryption epoch set (pg-env.ts), except those that set a
 * master key, sealing or the epoch themselves (vitest.pg.config.ts). Tests
 * seed user rows through `fixtureDb` (fixture-db.ts). The sweep here is its
 * guard: after each file, any mapped cell (from `mappedColumns()`, so a
 * column added later is covered) that holds plaintext and did not hold it
 * when the file started fails the file with its table, column and count.
 *
 * Not plaintext: null, "", a sealed value and the `budget_book.name` default
 * ("Personal").
 * The only escape is `sealed-sweep.allow.json`, by file: an allowed file
 * must still leave plaintext, so the list only shrinks.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { expect } from "vitest";
import { mappedColumns } from "~/server/crypto/fields";
import { adminDb } from "./pg-harness";

export { sealedSuite } from "./pg-harness";

/** Why a file may leave plaintext, by path from the repo root. */
const ALLOWED: Record<string, string> = JSON.parse(
	readFileSync(new URL("./sealed-sweep.allow.json", import.meta.url), "utf8"),
);

const plain = (table: string, column: string) =>
	`"${column}" <> '' AND NOT starts_with("${column}", E'\\x01k1:')
	${table === "budget_book" ? `AND "${column}" <> 'Personal'` : ""}`;

/** Every mapped cell holding plaintext now, as `table.column` to row ids. */
async function plaintextCells(): Promise<Map<string, string[]>> {
	const cells = new Map<string, string[]>();
	for (const [table, column] of mappedColumns()) {
		const rows = await adminDb.$queryRawUnsafe<{ id: string }[]>(
			`SELECT "id" FROM "${table}" WHERE ${plain(table, column)}`,
		);
		cells.set(
			`${table}.${column}`,
			rows.map((row) => row.id),
		);
	}
	return cells;
}

/** Snapshots the plaintext an earlier file left; call in `beforeAll`. */
export async function startSweep(): Promise<() => Promise<void>> {
	const before = await plaintextCells();
	return async () => {
		const hits: string[] = [];
		for (const [cell, ids] of await plaintextCells()) {
			const had = new Set(before.get(cell));
			const count = ids.filter((id) => !had.has(id)).length;
			if (count > 0) hits.push(`${cell}: ${count}`);
		}
		const file = relative(process.cwd(), expect.getState().testPath ?? "");
		const allowed = Object.hasOwn(ALLOWED, file);
		if (hits.length > 0 && !allowed)
			throw new Error(
				`Plaintext left in mapped columns with sealing on: ${hits.join(", ")}`,
			);
		if (hits.length === 0 && allowed)
			throw new Error(
				`${file} leaves no plaintext now; remove it from src/test/sealed-sweep.allow.json`,
			);
	};
}
