import { v1 } from "../common/meta";
import { syncPageOf, syncQuerySchema } from "../common/sync";
import { syncBookContract } from "./book";
import { SYNC_DESCRIPTION, SYNC_TAG } from "./route";
import {
	syncAccountHistorySchema,
	syncAccountLegSchema,
	syncAccountRateTypeSchema,
	syncAccountSchema,
	syncAccountSnapshotSchema,
	syncCategorySchema,
	syncExpenseSchema,
	syncRecurringTemplateSchema,
	syncTransferSchema,
} from "./schemas";

export * from "./book-schemas";
export * from "./schemas";

export const syncContract = {
	expenses: v1
		.route({
			method: "GET",
			path: "/sync/expenses",
			operationId: "syncExpenses",
			tags: SYNC_TAG,
			summary: "Changes to the caller's expenses",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncExpenseSchema)),
	categories: v1
		.route({
			method: "GET",
			path: "/sync/categories",
			operationId: "syncCategories",
			tags: SYNC_TAG,
			summary: "Changes to the caller's categories",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncCategorySchema)),
	recurringTemplates: v1
		.route({
			method: "GET",
			path: "/sync/recurring-templates",
			operationId: "syncRecurringTemplates",
			tags: SYNC_TAG,
			summary: "Changes to the caller's recurring templates",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncRecurringTemplateSchema)),
	accounts: v1
		.route({
			method: "GET",
			path: "/sync/accounts",
			operationId: "syncAccounts",
			tags: SYNC_TAG,
			summary: "Changes to the caller's accounts",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncAccountSchema)),
	accountSnapshots: v1
		.route({
			method: "GET",
			path: "/sync/account-snapshots",
			operationId: "syncAccountSnapshots",
			tags: SYNC_TAG,
			summary: "Changes to the caller's account snapshots",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncAccountSnapshotSchema)),
	accountLegs: v1
		.route({
			method: "GET",
			path: "/sync/account-legs",
			operationId: "syncAccountLegs",
			tags: SYNC_TAG,
			summary: "Changes to the caller's account legs",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncAccountLegSchema)),
	accountHistory: v1
		.route({
			method: "GET",
			path: "/sync/account-history",
			operationId: "syncAccountHistory",
			tags: SYNC_TAG,
			summary: "Changes to the caller's account history rows",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncAccountHistorySchema)),
	accountRateTypes: v1
		.route({
			method: "GET",
			path: "/sync/account-rate-types",
			operationId: "syncAccountRateTypes",
			tags: SYNC_TAG,
			summary: "Changes to the caller's account rate types",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncAccountRateTypeSchema)),
	transfers: v1
		.route({
			method: "GET",
			path: "/sync/transfers",
			operationId: "syncTransfers",
			tags: SYNC_TAG,
			summary: "Changes to the caller's transfers",
			description: SYNC_DESCRIPTION,
		})
		.meta({ scope: "sync" })
		.input(syncQuerySchema)
		.output(syncPageOf(syncTransferSchema)),
	...syncBookContract,
};
