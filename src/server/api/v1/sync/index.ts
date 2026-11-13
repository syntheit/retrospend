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
	accounts: v1.sync.accounts.handler(
		serve(({ context, input }) => sync.syncAccounts(signedIn(context), input)),
	),
	accountSnapshots: v1.sync.accountSnapshots.handler(
		serve(({ context, input }) =>
			sync.syncAccountSnapshots(signedIn(context), input),
		),
	),
	accountLegs: v1.sync.accountLegs.handler(
		serve(({ context, input }) =>
			sync.syncAccountLegs(signedIn(context), input),
		),
	),
	accountHistory: v1.sync.accountHistory.handler(
		serve(({ context, input }) =>
			sync.syncAccountHistory(signedIn(context), input),
		),
	),
	accountRateTypes: v1.sync.accountRateTypes.handler(
		serve(({ context, input }) =>
			sync.syncAccountRateTypes(signedIn(context), input),
		),
	),
	transfers: v1.sync.transfers.handler(
		serve(({ context, input }) => sync.syncTransfers(signedIn(context), input)),
	),
};
