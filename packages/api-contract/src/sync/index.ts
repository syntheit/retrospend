import { v1 } from "../common/meta";
import { syncPageOf, syncQuerySchema } from "../common/sync";
import {
	syncCategorySchema,
	syncExpenseSchema,
	syncRecurringTemplateSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["Sync"];

const DESCRIPTION =
	"Raw rows changed after `since`, oldest change first, plus a tombstone for each row deleted since. Page with the returned `cursor` until `hasMore` is false. The first pull (no `since`) returns every row once. A cursor the server can no longer honor answers 410 sync_reset_required: drop this entity's rows and pull again from the start. A change shows up once every older write transaction on the database server has finished, normally milliseconds. Cursors carry the server-wide commit position, so they reveal how much the instance writes, as the events feed does. Needs the `sync` session scope, held only by the Expo app's own session, never by a token or API key.";

export const syncContract = {
	expenses: v1
		.route({
			method: "GET",
			path: "/sync/expenses",
			operationId: "syncExpenses",
			tags: TAG,
			summary: "Changes to the caller's expenses",
			description: DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncExpenseSchema)),
	categories: v1
		.route({
			method: "GET",
			path: "/sync/categories",
			operationId: "syncCategories",
			tags: TAG,
			summary: "Changes to the caller's categories",
			description: DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncCategorySchema)),
	recurringTemplates: v1
		.route({
			method: "GET",
			path: "/sync/recurring-templates",
			operationId: "syncRecurringTemplates",
			tags: TAG,
			summary: "Changes to the caller's recurring templates",
			description: DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncRecurringTemplateSchema)),
};
