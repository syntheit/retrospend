/**
 * A local category version, as a placeholder. The server moves a category's
 * version by 1 for a write: SQL `version + 1` when the write names `name` (a
 * rename counts even when the name is the same text, the service never
 * compares), or the trigger `category_version_moves` when one of
 * CATEGORY_VERSION_COLUMNS changes value and the writer did not move the
 * version itself, so a write that does both still moves it once. The device
 * applies the same rule to its own copy so a chain of local writes reads in
 * order. It never claims to know the server's version: the answer names it
 * and the ack adopts it (the M5 rule of one ack version per row). This is the
 * only place a local category version moves.
 */
import {
	CATEGORY_VERSION_COLUMNS,
	type CategoryVersionColumn,
} from "@retrospend/domain/category-version";
import type { CategoryRow } from "./port";

/** One comparison per version column; a column added to the constant fails to compile here. */
const COLUMN_SAME: Record<
	CategoryVersionColumn,
	(a: CategoryRow, b: CategoryRow) => boolean
> = {
	color: (a, b) => a.color === b.color,
	icon: (a, b) => (a.icon ?? null) === (b.icon ?? null),
	excludeByDefault: (a, b) => a.excludeByDefault === b.excludeByDefault,
};

/** Whether the server would add 1 for this update; `renamed` is whether the write named `name`. */
export const movesCategoryVersion = (
	before: CategoryRow,
	after: CategoryRow,
	renamed: boolean,
): boolean =>
	renamed ||
	CATEGORY_VERSION_COLUMNS.some((c) => !COLUMN_SAME[c](before, after));

/** `after` with the version the server would give it. */
export const withLocalCategoryVersion = (
	before: CategoryRow,
	after: CategoryRow,
	renamed: boolean,
): CategoryRow => ({
	...after,
	version:
		before.version + (movesCategoryVersion(before, after, renamed) ? 1 : 0),
});
