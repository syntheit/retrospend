import * as z from "zod";

/**
 * Delta sync (E2EE lane P). A `/sync/{entity}` route returns the rows of one
 * entity that changed after `since` plus a tombstone for each row deleted
 * after it, so an offline client applies the delta without refetching. The
 * `cursor` of a page is the `since` of the next pull. It is opaque and
 * ordered by commit, never by a clock, so neither the client's clock nor a
 * slow transaction can drop a change.
 *
 * This replaced an unused `updatedSince` / `serverTime` shape that never
 * shipped in a release, so there is no deprecation window.
 */

/** Most rows one sync page carries. */
export const MAX_SYNC_LIMIT = 500;

/** Rows per sync page when the caller does not say. */
export const DEFAULT_SYNC_LIMIT = 200;

export const syncQuerySchema = z.object({
	since: z.string().min(1).max(512).optional().meta({
		description:
			"The cursor of the last page you applied. Omit it for the first pull, which returns every row once.",
	}),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_SYNC_LIMIT)
		.default(DEFAULT_SYNC_LIMIT),
});

export type SyncQuery = z.infer<typeof syncQuerySchema>;

export const tombstoneSchema = z
	.object({
		id: z.string(),
		deletedAt: z.iso.datetime({ offset: true }),
	})
	.meta({ id: "Tombstone" });

export type Tombstone = z.infer<typeof tombstoneSchema>;

/**
 * A sync page: changed rows, deleted ids, the cursor to send as `since` next
 * time and whether more follow now. A row changed again after this page
 * comes again later in its newer state, so apply rows by id; an id is never
 * in `items` and `tombstones` of the same page.
 */
export function syncPageOf<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		tombstones: z.array(tombstoneSchema),
		cursor: z.string(),
		hasMore: z.boolean(),
	});
}
