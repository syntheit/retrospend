import * as sync from "~/server/services/api-v1/sync";
import * as syncBook from "~/server/services/api-v1/sync-book";
import * as snapshots from "~/server/services/api-v1/sync-snapshots";
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
	budgetBooks: v1.sync.budgetBooks.handler(
		serve(({ context, input }) =>
			syncBook.syncBudgetBooks(signedIn(context), input),
		),
	),
	envelopeGroups: v1.sync.envelopeGroups.handler(
		serve(({ context, input }) =>
			syncBook.syncEnvelopeGroups(signedIn(context), input),
		),
	),
	envelopes: v1.sync.envelopes.handler(
		serve(({ context, input }) =>
			syncBook.syncEnvelopes(signedIn(context), input),
		),
	),
	envelopeCategories: v1.sync.envelopeCategories.handler(
		serve(({ context, input }) =>
			syncBook.syncEnvelopeCategories(signedIn(context), input),
		),
	),
	budgetMovements: v1.sync.budgetMovements.handler(
		serve(({ context, input }) =>
			syncBook.syncBudgetMovements(signedIn(context), input),
		),
	),
	bookPeriods: v1.sync.bookPeriods.handler(
		serve(({ context, input }) =>
			syncBook.syncBookPeriods(signedIn(context), input),
		),
	),
	monthCloses: v1.sync.monthCloses.handler(
		serve(({ context, input }) =>
			syncBook.syncMonthCloses(signedIn(context), input),
		),
	),
	incomeRules: v1.sync.incomeRules.handler(
		serve(({ context, input }) =>
			syncBook.syncIncomeRules(signedIn(context), input),
		),
	),
	incomeRuleRuns: v1.sync.incomeRuleRuns.handler(
		serve(({ context, input }) =>
			syncBook.syncIncomeRuleRuns(signedIn(context), input),
		),
	),
	payoffPlans: v1.sync.payoffPlans.handler(
		serve(({ context, input }) =>
			syncBook.syncPayoffPlans(signedIn(context), input),
		),
	),
	wealthTransfers: v1.sync.wealthTransfers.handler(
		serve(({ context, input }) =>
			syncBook.syncWealthTransfers(signedIn(context), input),
		),
	),
	envelopeChanges: v1.sync.envelopeChanges.handler(
		serve(({ context, input }) =>
			syncBook.syncEnvelopeChanges(signedIn(context), input),
		),
	),
	shares: v1.sync.shares.handler(
		serve(({ context }) => snapshots.syncShares(signedIn(context))),
	),
};
