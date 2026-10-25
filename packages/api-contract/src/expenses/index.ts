import * as z from "zod";
import { filterQuerySchema } from "../common/filter";
import { v1 } from "../common/meta";
import { cursorQuerySchema } from "../common/pagination";
import { undoTokenSchema } from "../common/preview";
import { idParamsSchema, idSchema } from "../core";
import { previewTwin, undoField, undoInputSchema } from "../ledger";
import {
	activityPageSchema,
	bulkCategorySchema,
	createExpenseSchema,
	duplicateQuerySchema,
	duplicateResultSchema,
	expenseSchema,
	titleSuggestionSchema,
	titleSuggestionsQuerySchema,
	updateExpenseSchema,
} from "./schemas";

export * from "./filter";
export * from "./schemas";

const TAG = ["Expenses"];

export const expenseWriteSchema = z
	.object({ expense: expenseSchema, ...undoField })
	.meta({ id: "ExpenseWrite" });

export const expenseDeleteSchema = z
	.object({ id: idSchema, ...undoField })
	.meta({ id: "ExpenseDelete" });

export const expenseUndoResultSchema = z
	.object({
		/** The expense it concerned; null when a bulk categorize was undone. */
		id: idSchema.nullable(),
		/** Puts the undo back (redo). */
		redo: undoTokenSchema,
	})
	.meta({ id: "ExpenseUndo" });

export const bulkCategoryResultSchema = z
	.object({ updated: z.int().min(0), ...undoField })
	.meta({ id: "BulkCategorizeResult" });

export const expenseListQuerySchema = cursorQuerySchema.extend(
	filterQuerySchema.shape,
);

/**
 * Personal entries: `GET /expenses` is the Activity list (every entry you
 * are part of, filtered), the writes are the Add expense family. Every money
 * write has a preview twin, and returns an undo token for POST
 * /expenses/undo. Deleting an entry that moved money in an account is
 * refused: undo it from its transfer.
 */
export const expensesContract = {
	list: v1
		.route({
			method: "GET",
			path: "/expenses",
			operationId: "listExpenses",
			tags: TAG,
			summary: "Activity: your entries, newest first, filtered",
			description:
				"Personal expenses, your shares of split expenses and payments, money in, refunds and own transfers. `filter` takes the web's grammar (see parseActivityFilter): from, to, cat, person, project, paidby, kind, q, range. With no dates it is this month in the caller's zone, as on the web, unless there is a q, a cat or range=all. The first page carries the count and your spending total for the filter.",
		})
		.meta({ scope: "read" })
		.input(expenseListQuerySchema)
		.output(activityPageSchema),
	duplicates: v1
		.route({
			method: "GET",
			path: "/expenses/duplicates",
			operationId: "checkExpenseDuplicate",
			tags: TAG,
			summary: "Is there an expense with this title, amount and day",
		})
		.meta({ scope: "read" })
		.input(duplicateQuerySchema)
		.output(duplicateResultSchema),
	titleSuggestions: v1
		.route({
			method: "GET",
			path: "/expenses/title-suggestions",
			operationId: "suggestExpenseTitles",
			tags: TAG,
			summary: "Titles you used before that contain the text",
			description:
				"At most 8, most used first, each with the category and amount of its latest use.",
		})
		.meta({ scope: "read" })
		.input(titleSuggestionsQuerySchema)
		.output(z.object({ items: z.array(titleSuggestionSchema) })),
	get: v1
		.route({
			method: "GET",
			path: "/expenses/{id}",
			operationId: "getExpense",
			tags: TAG,
			summary: "One entry",
		})
		.meta({ scope: "read" })
		.input(idParamsSchema)
		.output(expenseSchema),
	create: v1
		.route({
			method: "POST",
			path: "/expenses",
			operationId: "createExpense",
			tags: TAG,
			summary: "Add an expense",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "expense.created" })
		.input(createExpenseSchema)
		.output(expenseWriteSchema),
	previewCreate: previewTwin({
		path: "/expenses",
		of: "POST /expenses",
		operationId: "previewCreateExpense",
		tags: TAG,
		scope: "write:expenses",
		input: createExpenseSchema,
	}),
	update: v1
		.route({
			method: "PUT",
			path: "/expenses/{id}",
			operationId: "updateExpense",
			tags: TAG,
			summary: "Replace an expense's fields",
			description:
				"Every field is sent; one left out is cleared. Changing a split expense's money, or one that moved money in an account, is refused.",
		})
		.meta({ scope: "write:expenses", event: "expense.updated" })
		.input(updateExpenseSchema)
		.output(expenseWriteSchema),
	previewUpdate: previewTwin({
		path: "/expenses/{id}",
		of: "PUT /expenses/{id}",
		operationId: "previewUpdateExpense",
		tags: TAG,
		scope: "write:expenses",
		input: updateExpenseSchema,
	}),
	delete: v1
		.route({
			method: "DELETE",
			path: "/expenses/{id}",
			operationId: "deleteExpense",
			tags: TAG,
			summary: "Delete an expense and its spread parts",
		})
		.meta({ scope: "write:expenses", event: "expense.deleted" })
		.input(idParamsSchema)
		.output(expenseDeleteSchema),
	previewDelete: previewTwin({
		path: "/expenses/{id}",
		twinPath: "/expenses/{id}/delete/preview",
		of: "DELETE /expenses/{id}",
		operationId: "previewDeleteExpense",
		tags: TAG,
		scope: "write:expenses",
		input: idParamsSchema,
	}),
	bulkCategory: v1
		.route({
			method: "POST",
			path: "/expenses/bulk-category",
			operationId: "bulkCategorizeExpenses",
			tags: TAG,
			summary: "Put up to 500 expenses in one category",
			description:
				"Ids that are not yours are skipped; `updated` says how many changed. The undo puts each entry back in the category it had.",
		})
		.meta({ scope: "write:expenses", event: "expenses.categorized" })
		.input(bulkCategorySchema)
		.output(bulkCategoryResultSchema),
	previewBulkCategory: previewTwin({
		path: "/expenses/bulk-category",
		of: "POST /expenses/bulk-category",
		operationId: "previewBulkCategorizeExpenses",
		tags: TAG,
		scope: "write:expenses",
		input: bulkCategorySchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/expenses/undo",
			operationId: "undoExpenseWrite",
			tags: TAG,
			summary: "Revert an expense write from its undo token",
			description:
				"Tokens from create, update, delete and bulk-category (and from this route, as redo). A token is for its user, works once and expires after 24 hours. An update or create is refused with a conflict once the expense changed after it.",
		})
		.meta({ scope: "write:expenses", event: "expense.undone" })
		.input(undoInputSchema)
		.output(expenseUndoResultSchema),
	previewUndo: previewTwin({
		path: "/expenses/undo",
		of: "POST /expenses/undo",
		operationId: "previewUndoExpenseWrite",
		tags: TAG,
		scope: "write:expenses",
		input: undoInputSchema,
	}),
};
