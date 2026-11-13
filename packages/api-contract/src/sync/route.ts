import type * as z from "zod";
import { v1 } from "../common/meta";
import { syncPageOf, syncQuerySchema } from "../common/sync";

export const SYNC_TAG = ["Sync"];

export const SYNC_DESCRIPTION =
	"Raw rows changed after `since`, oldest change first, plus a tombstone for each row deleted since. Page with the returned `cursor` until `hasMore` is false. The first pull (no `since`) returns every row once. A cursor the server can no longer honor answers 410 sync_reset_required: drop this entity's rows and pull again from the start. A change shows up once every older write transaction on the database server has finished, normally milliseconds. Cursors carry the server-wide commit position, so they reveal how much the instance writes, as the events feed does. Needs the `sync` session scope: a session signed in by a client that identifies as the mobile app has it, an API key, personal token or device session never does. It reaches only the caller's own rows.";

/** The budget books' note: their rows follow the book, which must stay personal. */
export const SYNC_BOOK_DESCRIPTION = `${SYNC_DESCRIPTION} A budget book's rows are the caller's only while the book is personal and has no other member: when it gains a member or stops being personal, each of its rows comes back as a tombstone.`;

/** One GET /sync/{path} operation: the shared query, the page of `schema`'s rows, the sync scope. */
export function syncRoute<Schema extends z.ZodType>(
	path: string,
	operationId: string,
	summary: string,
	schema: Schema,
	description: string = SYNC_DESCRIPTION,
) {
	return v1
		.route({
			method: "GET",
			path: `/sync/${path}`,
			operationId,
			tags: SYNC_TAG,
			summary,
			description,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(schema));
}
