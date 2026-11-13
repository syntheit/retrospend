import * as sync from "~/server/services/api-v1/sync";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

export const syncRouter = {
	expenses: v1.sync.expenses.handler(
		serve(({ context, input }) => sync.syncExpenses(signedIn(context), input)),
	),
	categories: v1.sync.categories.handler(
		serve(({ context, input }) =>
			sync.syncCategories(signedIn(context), input),
		),
	),
	recurringTemplates: v1.sync.recurringTemplates.handler(
		serve(({ context, input }) =>
			sync.syncRecurringTemplates(signedIn(context), input),
		),
	),
};
