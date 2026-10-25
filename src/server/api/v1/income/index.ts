import * as income from "~/server/services/api-v1/income";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const i = v1.income;

export const incomeRouter = {
	create: i.create.handler(
		serve(({ context, input }) =>
			income.createIncome(signedIn(context), input),
		),
	),
	previewCreate: i.previewCreate.handler(
		serve(({ context, input }) =>
			income.previewCreateIncome(signedIn(context), input),
		),
	),
	delete: i.delete.handler(
		serve(({ context, input }) =>
			income.removeIncome(signedIn(context), input.id, input.templateId),
		),
	),
	previewDelete: i.previewDelete.handler(
		serve(({ context, input }) =>
			income.previewRemoveIncome(signedIn(context), input.id, input.templateId),
		),
	),
	undo: i.undo.handler(
		serve(({ context, input }) =>
			income.undoIncomeWrite(signedIn(context), input.token),
		),
	),
	previewUndo: i.previewUndo.handler(
		serve(({ context, input }) =>
			income.previewUndoIncomeWrite(signedIn(context), input.token),
		),
	),
};
