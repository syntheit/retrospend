/** What a device may keep outside the store for a category: no name. */
import type { CategoryRow } from "./port";

/**
 * The category columns that hold a person's free text. A src test holds this
 * list equal to the keys of FIELD_MAP.Category.columns, which the engine
 * cannot import (src/server/crypto/__tests__/engine-text-columns.test.ts).
 */
export const CATEGORY_TEXT_COLUMNS = ["name"] as const;

export type TextFreeCategoryRow = Omit<
	CategoryRow,
	(typeof CATEGORY_TEXT_COLUMNS)[number]
>;

/** The row as the device may hold it outside the store: every column except the name. */
export function categoryWithoutText(row: CategoryRow): TextFreeCategoryRow {
	const out: Record<string, unknown> = { ...row };
	for (const column of CATEGORY_TEXT_COLUMNS) delete out[column];
	return out as TextFreeCategoryRow;
}

/** One category an entry changed, as the device booked it: no name. */
export interface CategoryChange {
	readonly table: "categories";
	readonly id: string;
	readonly before: TextFreeCategoryRow | null;
	readonly after: TextFreeCategoryRow | null;
}
