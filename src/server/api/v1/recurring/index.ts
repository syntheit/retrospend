import * as recurring from "~/server/services/api-v1/recurring";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const r = v1.recurring;

export const recurringRouter = {
	list: r.list.handler(
		serve(({ context, input }) =>
			recurring.listRecurring(signedIn(context), input),
		),
	),
	summary: r.summary.handler(
		serve(({ context }) => recurring.recurringSummary(signedIn(context))),
	),
	get: r.get.handler(
		serve(({ context, input }) =>
			recurring.readRecurring(signedIn(context), input.id),
		),
	),
	create: r.create.handler(
		serve(({ context, input }) =>
			recurring.addRecurring(signedIn(context), input),
		),
	),
	update: r.update.handler(
		serve(({ context, input }) =>
			recurring.changeRecurring(signedIn(context), input),
		),
	),
	delete: r.delete.handler(
		serve(({ context, input }) =>
			recurring.removeRecurring(signedIn(context), input.id),
		),
	),
	confirm: r.confirm.handler(
		serve(({ context, input }) =>
			recurring.confirmRecurring(signedIn(context), input),
		),
	),
	previewConfirm: r.previewConfirm.handler(
		serve(({ context, input }) =>
			recurring.previewConfirmRecurring(signedIn(context), input),
		),
	),
	undo: r.undo.handler(
		serve(({ context, input }) =>
			recurring.undoRecurringConfirm(signedIn(context), input.token),
		),
	),
	previewUndo: r.previewUndo.handler(
		serve(({ context, input }) =>
			recurring.previewUndoRecurringConfirm(signedIn(context), input.token),
		),
	),
};
