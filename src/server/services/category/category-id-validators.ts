/**
 * Every validator that still parses a row id as a cuid (`z.cuid()`), by file
 * and field name. A cuid is `c` followed by letters and digits, so a UUID
 * (what a device makes for a row it creates offline) is refused. A category
 * or an account is named through `categoryIdSchema` / `accountIdSchema`
 * (src/lib/schemas/row-ids.ts), which take both; the cuid-only ones left are
 * ids a device never makes. category-id-validators.test.ts pins this list
 * against the source by search.
 */

/** file: field name: how many validators of that name the file has. */
export type Validators = Record<string, Record<string, number>>;

/**
 * Cuid-only ids that stay. Each is safe because the row is made on the
 * server only: a project, an exchange rate and an invite have no offline
 * create on a device (a project is created online, a rate comes from the
 * rate service, an invite is issued by the server).
 */
export const OTHER_ID_VALIDATORS: Validators = {
	"src/server/services/entry/input.ts": { projectId: 2 },
	"src/server/api/routers/shared-transaction.ts": { projectId: 2 },
	"src/server/api/routers/preferences.ts": { exchangeRateId: 1 },
	"src/server/api/routers/invite.ts": { id: 2 },
};
