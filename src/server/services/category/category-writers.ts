/**
 * M3 PR0: the inventory of every statement that writes the category table,
 * by file, and of every caller of the functions that write it without naming
 * the table. category-writers.test.ts pins both against a search of the
 * repository, so a new writer fails the test until it is classed here.
 *
 * Classes (slice-device-categories.md, Revision 2 item 7):
 * - device-covered: a write the device will own in M3 (create, edit);
 * - online: stays a server-only write (delete, merge, seeding, scripts); the
 *   version trigger bumps on a script's rename or color fix, which parks a
 *   pending device edit, as it should;
 * - not versioned: writes nameIndex only, so it must never bump the version.
 */
export type WriterClass = "device-covered" | "online" | "not versioned";

/** file: [statements, class, which statements]. */
export const WRITERS: Record<string, readonly [number, WriterClass, string]> = {
	// insertCategory (create, and the restore's insert) and updateCategory:
	// device-covered; insertCategoriesOnce (seed, income names) is online.
	"src/server/services/category.service.ts": [
		3,
		"device-covered",
		"create, update; the seed's createMany is online",
	],
	// The K9 backfill and recompute: the index column only.
	"src/server/services/category-name-index.service.ts": [
		1,
		"not versioned",
		"update of nameIndex",
	],
	// Delete and merge stay online; the restore inserts through insertCategory.
	"src/server/services/category/merge.mutation.ts": [1, "online", "delete"],
	// Two deletes, two updates (rename, color), two creates, run by hand.
	"scripts/migrate-default-categories.ts": [
		6,
		"online",
		"delete x2, update x2, create x2",
	],
};

/**
 * Files that call a function which writes the table through the statements
 * above, by function. Another caller is a new path to the table.
 */
export const CALLERS: Record<string, readonly string[]> = {
	createCategory: [
		"src/server/api/routers/categories.ts",
		"src/server/services/api-v1/categories.ts",
	],
	updateCategory: [
		"src/server/api/routers/categories.ts",
		"src/server/services/api-v1/categories.ts",
	],
	insertCategory: ["src/server/services/category/merge.mutation.ts"],
	insertCategoriesOnce: ["src/server/services/money-in.service.ts"],
	seedDefaultCategories: [
		"scripts/sync-default-categories.ts",
		"src/server/better-auth/config.ts",
	],
	ensureIncomeCategories: [
		"src/server/services/entry/catalog.ts",
		"src/server/services/income/add.mutation.ts",
	],
};

/**
 * Where `category.version` is written by code (M3 PR1a, Revisions 2 and 3):
 * only category.service.ts, in two statements: updateCategory's SQL increment
 * on a rename (the only update that sets it), and insertCategory passing the
 * version a restore brings back (merge.mutation.ts hands it the stash's).
 * Everything else moves the version through the database trigger over
 * CATEGORY_VERSION_COLUMNS, which no caller names, so a script's color fix
 * bumps and a reseal, which writes the name and its index only, never does.
 * category-writers.test.ts searches every writer file for a write that names
 * the version and compares with this.
 */
export const VERSION_SETTERS: Record<string, readonly [number, string]> = {
	"src/server/services/category.service.ts": [
		2,
		"updateCategory's `data.version = { increment: 1 }` on a rename; insertCategory's `version: input.version` for a restore",
	],
};
