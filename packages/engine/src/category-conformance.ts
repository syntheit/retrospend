/**
 * The category vectors' checks, shared by the device (category-vectors.test.ts,
 * over LocalDb) and the server (src/server/services/__tests__/
 * category-conformance.pg.test.ts, which runs the same steps through the v1
 * routes and reads the rows back as a device store). `checkCategoryState`
 * holds a store to a step's hand-derived expectations; `differingCategoryRows`
 * holds two stores equal row by row, on every column the engine keeps.
 */
import { expectDecimal, need, USER } from "./account-conformance";
import type {
	CategoryVector,
	ExpectedCategory,
	SeedCategory,
} from "./category-vector-types";
import { expectEqual } from "./conformance";
import { seededStore } from "./local-expense-create";
import { OWED_ID, type Reader, type TableRows } from "./port";
import { readDeviceFigures } from "./registry";
import {
	byKey,
	type Columns,
	differing,
	exact,
	sameDecimal,
} from "./wealth-columns";
import { sameColumnValue } from "./write-parity";
import type { ExpectedCategoryState } from "./category-vector-types";

type CategoryRow = TableRows["categories"];

/** One comparison per column of a category row: a column added to the row fails to compile until it is named here. */
export const CATEGORY_COLUMNS: Columns<CategoryRow> = {
	id: byKey,
	kind: exact,
	name: exact,
	color: exact,
	icon: exact,
	excludeByDefault: exact,
	version: exact,
};

/** The expense columns a category's default can decide, plus what the vector derived by hand. */
const EXPENSE_COLUMNS = [
	"categoryId",
	"categoryKind",
	"excludeFromAnalytics",
	"currency",
	"amount",
	"amountInUSD",
	"homeCurrency",
	"homeAmount",
	"date",
	"direction",
	"status",
] as const;

function checkCategory(row: CategoryRow, want: ExpectedCategory) {
	const what = `category ${row.id}`;
	expectEqual(
		[
			row.name,
			row.color,
			row.icon ?? null,
			row.kind,
			row.excludeByDefault,
			row.version,
		],
		[
			want.name,
			want.color,
			want.icon,
			want.kind,
			want.excludeByDefault,
			want.version,
		],
		what,
	);
}

/** Holds `store` to what a step's author derived by hand. */
export async function checkCategoryState(
	store: Reader,
	want: ExpectedCategoryState,
	now: Date,
): Promise<void> {
	for (const [id, expected] of Object.entries(want.categories ?? {}))
		checkCategory(
			need(store.get("categories", id), `category ${id}`),
			expected,
		);
	if (want.categoryCount !== undefined)
		expectEqual(
			store.list("categories").length,
			want.categoryCount,
			"category count",
		);
	for (const [id, expected] of Object.entries(want.expenses ?? {})) {
		const row = need(store.get("expenses", id), `expense ${id}`);
		expectEqual(
			[
				row.categoryId,
				row.categoryKind,
				row.excludeFromAnalytics,
				row.currency,
			],
			[
				expected.categoryId,
				expected.categoryKind,
				expected.excludeFromAnalytics,
				expected.currency,
			],
			`expense ${id}`,
		);
		expectDecimal(String(row.amount), expected.amount, `expense ${id} amount`);
		expectDecimal(
			row.homeAmount == null ? null : String(row.homeAmount),
			expected.homeAmount,
			`expense ${id} homeAmount`,
		);
	}
	if (want.spent !== undefined) {
		const read = await readDeviceFigures(store, USER, ["spent"], {}, () => now);
		expectEqual(read.readings.get("spent"), want.spent, "spent");
	}
}

/**
 * The differences between the device's rows and the server's after the same
 * write, as `table id: column, column` lines; empty when they are equal.
 * Categories are compared by id on every column they keep (the version
 * included: the device's is a placeholder that follows the same count);
 * expenses by id on the columns a category's default decides.
 */
export function differingCategoryRows(
	device: Reader,
	server: Reader,
): string[] {
	const lines: string[] = [];
	const byId = <T extends { id: string }>(
		table: string,
		a: readonly T[],
		b: readonly T[],
		diff: (x: T, y: T) => string[],
	) => {
		const other = new Map(b.map((r) => [r.id, r]));
		for (const row of a) {
			const match = other.get(row.id);
			if (!match) lines.push(`${table} ${row.id}: only on the device`);
			else {
				const fields = diff(row, match);
				if (fields.length > 0)
					lines.push(`${table} ${row.id}: ${fields.join(", ")}`);
			}
			other.delete(row.id);
		}
		for (const id of other.keys())
			lines.push(`${table} ${id}: only on the server`);
	};
	byId(
		"categories",
		device.list("categories"),
		server.list("categories"),
		(d, s) => differing(CATEGORY_COLUMNS, d, s),
	);
	byId("expenses", device.list("expenses"), server.list("expenses"), (d, s) =>
		EXPENSE_COLUMNS.filter((k) => !sameColumnValue(k, d[k], s[k])),
	);
	return lines;
}

export { sameDecimal };

/** The row a vector's seed puts in a store. */
export const seedCategoryRow = (c: SeedCategory): CategoryRow => ({
	id: c.id,
	kind: c.kind,
	name: c.name,
	color: c.color,
	icon: c.icon ?? null,
	excludeByDefault: c.excludeByDefault ?? false,
	version: c.version ?? 0,
});

/** The settings, rates and categories of a vector as a device store. */
export async function seededCategoryStore(
	vector: Pick<CategoryVector, "seed" | "categories">,
) {
	const store = await seededStore(vector.seed);
	await store.transaction((tx) => {
		tx.put("owed", {
			id: OWED_ID,
			currency: vector.seed.homeCurrency,
			owedToYou: 0,
			youOwe: 0,
		});
		for (const c of vector.categories ?? [])
			tx.put("categories", seedCategoryRow(c));
	});
	return store;
}
