import * as z from "zod";
import { moneyWrite } from "../budget/routes";
import { v1 } from "../common/meta";
import { undoTokenSchema } from "../common/preview";
import { previewTwin, undoInputSchema } from "../ledger";
import { accountsExtrasContract } from "./extras";
import {
	accountBalanceRevertedSchema,
	accountDetailSchema,
	accountIdParamsSchema,
	accountItemSchema,
	accountListSchema,
	accountRateRevertedSchema,
	accountRemovedSchema,
	balanceUpdateSchema,
	createAccountSchema,
	defaultAccountsSchema,
	exportCsvSchema,
	netWorthQuerySchema,
	netWorthSchema,
	rateTypeSwitchSchema,
	setDefaultAccountSchema,
	setRateTypeSchema,
	updateAccountSchema,
	updateBalanceSchema,
} from "./schemas";

export * from "./extras";
export * from "./schemas";

const TAG = ["Accounts"];

const create = moneyWrite({
	path: "/accounts",
	operationId: "createAccount",
	previewId: "previewCreateAccount",
	summary: "Add an account",
	event: "account.created",
	input: createAccountSchema,
	result: accountItemSchema,
	status: 201,
});
const update = moneyWrite({
	method: "PUT",
	path: "/accounts/{id}",
	operationId: "updateAccount",
	previewId: "previewUpdateAccount",
	summary: "Replace an account's fields",
	event: "account.updated",
	input: updateAccountSchema,
	result: accountItemSchema,
});
const close = moneyWrite({
	path: "/accounts/{id}/close",
	operationId: "closeAccount",
	previewId: "previewCloseAccount",
	summary: "Close an account",
	event: "account.closed",
	input: accountIdParamsSchema,
	result: accountItemSchema,
});
const reopen = moneyWrite({
	path: "/accounts/{id}/reopen",
	operationId: "reopenAccount",
	previewId: "previewReopenAccount",
	summary: "Reopen a closed account",
	event: "account.reopened",
	input: accountIdParamsSchema,
	result: accountItemSchema,
});
const remove = moneyWrite({
	path: "/accounts/{id}/delete",
	operationId: "deleteAccount",
	previewId: "previewDeleteAccount",
	summary: "Delete an account and its whole history",
	event: "account.deleted",
	input: accountIdParamsSchema,
	result: accountRemovedSchema,
	noUndo: "the history goes with the account, so there is nothing to put back.",
});
const updateBalance = moneyWrite({
	path: "/accounts/{id}/balance",
	operationId: "updateAccountBalance",
	previewId: "previewUpdateAccountBalance",
	summary: "Say what the account holds today",
	event: "account.balance_updated",
	input: updateBalanceSchema,
	result: balanceUpdateSchema,
});
const setRateType = moneyWrite({
	path: "/accounts/{id}/rate-type",
	operationId: "setAccountRateType",
	previewId: "previewSetAccountRateType",
	summary: "Value the account at another rate type from a day on",
	event: "account.rate_type_set",
	input: setRateTypeSchema,
	result: rateTypeSwitchSchema,
});

/** What an undo token reverted; `kind` names the inverse the token carried. */
export const accountUndoResultSchema = z
	.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("account.delete"),
			result: accountRemovedSchema,
		}),
		z.object({ kind: z.literal("account.restore"), result: accountItemSchema }),
		z.object({ kind: z.literal("account.close"), result: accountItemSchema }),
		z.object({ kind: z.literal("account.reopen"), result: accountItemSchema }),
		z.object({
			kind: z.literal("balance.revert"),
			result: accountBalanceRevertedSchema,
		}),
		z.object({
			kind: z.literal("rate_type.revert"),
			result: accountRateRevertedSchema,
		}),
	])
	.meta({ id: "AccountUndoResult" });

/**
 * Accounts and net worth. Money writes have a preview twin and an undo token
 * for POST /accounts/undo, except deleting an account, which cannot be taken
 * back. Amounts that go in are decimal text; amounts that come out are
 * `{ minor, currency }`. Transfers and income are under /transfers and
 * /income.
 */
export const accountsContract = {
	...accountsExtrasContract,
	list: v1
		.route({
			method: "GET",
			path: "/accounts",
			operationId: "listAccounts",
			tags: TAG,
			summary: "Your accounts, open and closed",
		})
		.meta({ scope: "read" })
		.output(accountListSchema),
	netWorth: v1
		.route({
			method: "GET",
			path: "/accounts/net-worth",
			operationId: "getNetWorth",
			tags: TAG,
			summary: "Net worth, why it moved and its series",
			description:
				"The same net worth as GET /figures?ids=netWorth. The change parts add up to the total, to the minor unit.",
		})
		.meta({ scope: "read" })
		.input(netWorthQuerySchema)
		.output(netWorthSchema),
	defaults: v1
		.route({
			method: "GET",
			path: "/accounts/defaults",
			operationId: "getDefaultAccounts",
			tags: TAG,
			summary: "The account new entries prefill, per currency",
		})
		.meta({ scope: "read" })
		.output(defaultAccountsSchema),
	export: v1
		.route({
			method: "GET",
			path: "/accounts/export",
			operationId: "exportAccounts",
			tags: TAG,
			summary: "Open accounts as CSV text",
		})
		.meta({ scope: "read" })
		.output(exportCsvSchema),
	get: v1
		.route({
			method: "GET",
			path: "/accounts/{id}",
			operationId: "getAccount",
			tags: TAG,
			summary: "An account with its history of legs and rate types",
		})
		.meta({ scope: "read" })
		.input(accountIdParamsSchema)
		.output(accountDetailSchema),
	setDefault: v1
		.route({
			method: "PUT",
			path: "/accounts/defaults/{currency}",
			operationId: "setDefaultAccount",
			tags: TAG,
			summary: "Choose (or clear) the default account for a currency",
			description: "A prefill only: it moves no money.",
		})
		.meta({ scope: "write:settings", event: "account.default_set" })
		.input(setDefaultAccountSchema)
		.output(defaultAccountsSchema),
	create: create.write,
	previewCreate: create.preview,
	update: update.write,
	previewUpdate: update.preview,
	close: close.write,
	previewClose: close.preview,
	reopen: reopen.write,
	previewReopen: reopen.preview,
	delete: remove.write,
	previewDelete: remove.preview,
	updateBalance: updateBalance.write,
	previewUpdateBalance: updateBalance.preview,
	setRateType: setRateType.write,
	previewSetRateType: setRateType.preview,
	undo: v1
		.route({
			method: "POST",
			path: "/accounts/undo",
			operationId: "undoAccountWrite",
			tags: TAG,
			summary: "Revert an account write from its undo token",
			description:
				"Each token works once, for 24 hours. A token whose account changed since the write answers 409.",
		})
		.meta({ scope: "write:money", event: "account.undone" })
		.input(undoInputSchema)
		.output(
			z.object({
				result: accountUndoResultSchema,
				redo: undoTokenSchema.nullable(),
			}),
		),
	previewUndo: previewTwin({
		path: "/accounts/undo",
		of: "POST /accounts/undo",
		operationId: "previewUndoAccountWrite",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
