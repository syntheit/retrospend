/**
 * Which category columns move a category's `version`: the one owner of the
 * list (M3, slice-device-categories.md Revisions 2 and 3). The database
 * trigger `category_version_moves` bumps the version by 1 when one of
 * CATEGORY_VERSION_COLUMNS changes value and the writer did not move the
 * version itself. A rename is not in the list: the name is sealed text that
 * encryption-at-rest backfills and key rotations rewrite without changing it,
 * so a rename is versioned by the service (`version = version + 1` in the
 * same statement), never by the trigger.
 * `src/test/migrations/category-version.pg.test.ts` reads the trigger function
 * from the catalog and fails unless it names exactly these columns and every
 * column of the schema is in one list.
 */

/** Device-editable columns the trigger watches: a change to any of them is a new version. */
export const CATEGORY_VERSION_COLUMNS = [
	"color",
	"icon",
	"excludeByDefault",
] as const;

export type CategoryVersionColumn = (typeof CATEGORY_VERSION_COLUMNS)[number];

/**
 * Columns the trigger never reads, each with the reason it is safe. A pending
 * device edit must not park because of a write the person did not make.
 */
export const CATEGORY_VERSION_SKIPPED = {
	id: "the key; it never changes",
	userId: "the owner; it never changes",
	version: "the counter itself",
	name: "versioned by the service's SQL increment, not by the trigger: a reseal (D12 backfill, K9 rotation) rewrites the stored bytes with a fresh nonce without changing the name, and must never park a pending edit",
	nameIndex:
		"a keyed hash of the name, rewritten by the backfill and by a key change; the name's own version rule covers it",
	kind: "set on create and never edited",
	isFixed: "set on create and never edited",
} as const satisfies Record<string, string>;

export type CategoryVersionSkipped = keyof typeof CATEGORY_VERSION_SKIPPED;

/**
 * The version a category comes back at when its undo stash was written before
 * the stash carried one (a v2 stash). It is above any version a device can
 * hold, so a device's write queued before the delete parks instead of landing
 * on a category it never saw.
 */
export const LEGACY_STASH_CATEGORY_VERSION = 1_000_000;

export const CATEGORY_CHANGED_MESSAGE = "This category changed since you read it";

/**
 * A category write that named the version it read, and the category has
 * another now (a device or the web changed it, or it is gone). Nothing was
 * written; the caller reads the category again and decides. The server
 * answers 409 `category_changed`; the device parks the write.
 */
export class CategoryChangedError extends Error {
	override readonly name = "CategoryChangedError";
	constructor() {
		super(CATEGORY_CHANGED_MESSAGE);
	}
}
