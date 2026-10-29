import { parseActivityFilter } from "@retrospend/api-contract";
import * as expenses from "~/server/services/api-v1/expenses";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

const e = v1.expenses;

/** The `filter` query in the web's grammar; a value that does not parse is refused, never ignored. */
function filterOf(raw: string | undefined) {
	const parsed = parseActivityFilter(raw);
	if (!parsed.ok) throw problem("invalid_filter", parsed.message);
	return parsed.value;
}

export const expensesRouter = {
	list: e.list.handler(
		serve(({ context, input }) =>
			expenses.listExpenses(signedIn(context), filterOf(input.filter), input),
		),
	),
	duplicates: e.duplicates.handler(
		serve(({ context, input }) =>
			expenses.checkDuplicate(signedIn(context), input),
		),
	),
	titleSuggestions: e.titleSuggestions.handler(
		serve(({ context, input }) =>
			expenses.suggestTitles(signedIn(context), input.q),
		),
	),
	get: e.get.handler(
		serve(({ context, input }) =>
			expenses.readExpense(signedIn(context), input.id),
		),
	),
	create: e.create.handler(
		serve(({ context, input }) =>
			expenses.addExpense(signedIn(context), input),
		),
	),
	previewCreate: e.previewCreate.handler(
		serve(({ context, input }) =>
			expenses.previewAddExpense(signedIn(context), input),
		),
	),
	update: e.update.handler(
		serve(({ context, input }) =>
			expenses.replaceExpense(signedIn(context), input),
		),
	),
	previewUpdate: e.previewUpdate.handler(
		serve(({ context, input }) =>
			expenses.previewReplaceExpense(signedIn(context), input),
		),
	),
	delete: e.delete.handler(
		serve(({ context, input }) =>
			expenses.removeExpense(signedIn(context), input.id),
		),
	),
	previewDelete: e.previewDelete.handler(
		serve(({ context, input }) =>
			expenses.previewRemoveExpense(signedIn(context), input.id),
		),
	),
	bulkCategory: e.bulkCategory.handler(
		serve(({ context, input }) =>
			expenses.categorizeExpenses(signedIn(context), input),
		),
	),
	previewBulkCategory: e.previewBulkCategory.handler(
		serve(({ context, input }) =>
			expenses.previewCategorizeExpenses(signedIn(context), input),
		),
	),
	bulkDelete: e.bulkDelete.handler(
		serve(({ context, input }) =>
			expenses.removeExpenses(signedIn(context), input),
		),
	),
	previewBulkDelete: e.previewBulkDelete.handler(
		serve(({ context, input }) =>
			expenses.previewRemoveExpenses(signedIn(context), input),
		),
	),
	undo: e.undo.handler(
		serve(({ context, input }) =>
			expenses.undoExpenseWrite(signedIn(context), input.token),
		),
	),
	previewUndo: e.previewUndo.handler(
		serve(({ context, input }) =>
			expenses.previewUndoExpenseWrite(signedIn(context), input.token),
		),
	),
};
