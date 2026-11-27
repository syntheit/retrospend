/**
 * M3 PR0: every validator that parses a row id as a cuid (`z.cuid()`), by
 * file and field name, found by search. A cuid is `c` followed by letters and
 * digits, so a UUID (what a device makes for a row it creates offline) is
 * refused. v1 takes any id (`idSchema` in api-contract core); these tRPC and
 * shared schemas do not. category-id-validators.test.ts pins both lists
 * against the source; M3 PR1 replaces the category ones with one
 * `categoryIdSchema` (cuid or uuid) and empties CATEGORY.
 */

/** file: field name: how many validators of that name the file has. */
export type Validators = Record<string, Record<string, number>>;

/** The category references (slice-device-categories.md Rev 2 item 5). */
export const CATEGORY_ID_VALIDATORS: Validators = {
	"src/server/services/entry/input.ts": { categoryId: 2 },
	"src/server/api/routers/expense.ts": { categoryId: 2 },
	"src/server/api/routers/shared-transaction.ts": { categoryId: 2 },
	"src/server/api/routers/preferences.ts": { categoryId: 2 },
	// removeSchema's id and targetId, and update's id.
	"src/server/api/routers/categories.ts": { id: 2, targetId: 1 },
	"src/lib/schemas/recurring.ts": { categoryId: 2 },
};

/**
 * Account ids. A device-made account has a UUID id (M6), so the web cannot
 * read (wealth byId), edit, change the icon of, or update the balance of one
 * until these take a UUID too: M3 PR1 fixes byId only; the rest are open.
 */
export const ACCOUNT_ID_VALIDATORS: Validators = {
	"src/server/api/routers/wealth.ts": { id: 1 },
	"src/server/services/accounts/input.ts": {
		id: 2,
		assetId: 1,
		templateId: 1,
	},
};

/** Other row ids that are cuid only; not part of M3. */
export const OTHER_ID_VALIDATORS: Validators = {
	"src/server/services/entry/input.ts": { projectId: 2 },
	"src/server/api/routers/shared-transaction.ts": { projectId: 2 },
	"src/server/api/routers/preferences.ts": { exchangeRateId: 1 },
	"src/server/api/routers/invite.ts": { id: 2 },
};
