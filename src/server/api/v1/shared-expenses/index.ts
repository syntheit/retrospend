import * as shared from "~/server/services/api-v1/shared-expenses";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const s = v1["shared-expenses"];

export const sharedExpensesRouter = {
	create: s.create.handler(
		serve(({ context, input }) =>
			shared.addSharedExpense(signedIn(context), input),
		),
	),
	previewCreate: s.previewCreate.handler(
		serve(({ context, input }) =>
			shared.previewAddSharedExpense(signedIn(context), input),
		),
	),
	update: s.update.handler(
		serve(({ context, input }) =>
			shared.replaceSharedExpense(signedIn(context), input),
		),
	),
	previewUpdate: s.previewUpdate.handler(
		serve(({ context, input }) =>
			shared.previewReplaceSharedExpense(signedIn(context), input),
		),
	),
	delete: s.delete.handler(
		serve(({ context, input }) =>
			shared.removeSharedExpense(signedIn(context), input),
		),
	),
	previewDelete: s.previewDelete.handler(
		serve(({ context, input }) =>
			shared.previewRemoveSharedExpense(signedIn(context), input),
		),
	),
	undo: s.undo.handler(
		serve(({ context, input }) =>
			shared.undoSharedExpenseWrite(signedIn(context), input.token),
		),
	),
	previewUndo: s.previewUndo.handler(
		serve(({ context, input }) =>
			shared.previewUndoSharedExpenseWrite(signedIn(context), input.token),
		),
	),
	accept: s.accept.handler(
		serve(({ context, input }) =>
			shared.acceptSharedExpense(signedIn(context), input.id),
		),
	),
	reject: s.reject.handler(
		serve(({ context, input }) =>
			shared.rejectSharedExpense(signedIn(context), input.id, input.reason),
		),
	),
};
