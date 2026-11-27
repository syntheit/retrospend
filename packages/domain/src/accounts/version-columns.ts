/**
 * Which asset_account columns move an account's `version`: the one owner of
 * the list (M6, slice-device-wealth.md Revision 3 item 1). The database trigger
 * `asset_account_version_moves` bumps the version by 1 when one of
 * ACCOUNT_VERSION_COLUMNS changes value; a device's local write bumps its own
 * copy by the same rule. `src/test/migrations/account-version.pg.test.ts`
 * reads the trigger function from the catalog and fails unless it names
 * exactly these columns and every column of the schema is in one list.
 */

/** Device-editable columns: a change to any of them is a new version. */
export const ACCOUNT_VERSION_COLUMNS = [
	"type",
	"currency",
	"exchangeRateType",
	"closedAt",
	"inBudget",
	"isLiquid",
	"interestRate",
	"minimumPayment",
	"dueDate",
] as const;

export type AccountVersionColumn = (typeof ACCOUNT_VERSION_COLUMNS)[number];

/**
 * Columns that never move the version, each with the reason it is safe. A
 * pending device edit must not park because of a write the person did not make
 * to the account itself.
 */
export const ACCOUNT_VERSION_SKIPPED = {
	id: "the key; it never changes",
	userId: "the owner; it never changes",
	createdAt: "set once on insert",
	updatedAt:
		"the 'Updated' date on screen; it moves with a counted move, a checkpoint and every Prisma update, so it says nothing about what a device edited",
	version: "the counter itself",
	balance:
		"moved by every leg (a transfer, an income leg, a balance update) and compared on its own by expectedBalance, so a leg never spoils a pending rate type or field edit",
	countedUnits:
		"moved by the leg trigger and the counted move of a transfer; budget bookkeeping, not an account edit",
	exchangeRate:
		"the stored rate of the custom rate type or the rate a checkpoint resolved; it follows the rate type, which is versioned",
	iconKind:
		"an icon swap is a picture, not money; it reaches devices through the sync log and must not park an edit",
	iconValue: "as iconKind",
	name: "sealed text: encryption-at-rest backfills (D12) and key rotations (K9) rewrite the stored bytes with a fresh nonce without changing the name, which would park every pending edit; a rename is text, not money, and concurrent renames are last write wins",
} as const satisfies Record<string, string>;

export type AccountVersionSkipped = keyof typeof ACCOUNT_VERSION_SKIPPED;
