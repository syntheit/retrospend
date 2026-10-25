import * as payments from "~/server/services/api-v1/payments";
import * as extras from "~/server/services/api-v1/payments-extras";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.payments;

export const paymentsRouter = {
	remove: p.remove.handler(
		serve(({ context, input }) =>
			extras.removePayment(signedIn(context), input.id),
		),
	),
	previewRemove: p.previewRemove.handler(
		serve(({ context, input }) =>
			extras.previewRemovePayment(signedIn(context), input.id),
		),
	),
	squareUpOptions: p.squareUpOptions.handler(
		serve(({ context, input }) =>
			extras.readSquareUpOptions(signedIn(context), input),
		),
	),
	squareUp: p.squareUp.handler(
		serve(({ context, input }) => extras.squareUp(signedIn(context), input)),
	),
	previewSquareUp: p.previewSquareUp.handler(
		serve(({ context, input }) =>
			extras.previewSquareUp(signedIn(context), input),
		),
	),
	record: p.record.handler(
		serve(({ context, input }) =>
			payments.recordPaymentWrite(signedIn(context), input),
		),
	),
	previewRecord: p.previewRecord.handler(
		serve(({ context, input }) =>
			payments.previewRecordPayment(signedIn(context), input),
		),
	),
	confirm: p.confirm.handler(
		serve(({ context, input }) =>
			payments.confirmPaymentWrite(signedIn(context), input),
		),
	),
	previewConfirm: p.previewConfirm.handler(
		serve(({ context, input }) =>
			payments.previewConfirmPayment(signedIn(context), input),
		),
	),
	notReceived: p.notReceived.handler(
		serve(({ context, input }) =>
			payments.paymentNotReceived(signedIn(context), input),
		),
	),
	previewNotReceived: p.previewNotReceived.handler(
		serve(({ context, input }) =>
			payments.previewNotReceived(signedIn(context), input),
		),
	),
	remind: p.remind.handler(
		serve(({ context, input }) =>
			payments.remindPayment(signedIn(context), input.id),
		),
	),
	undo: p.undo.handler(
		serve(({ context, input }) =>
			payments.undoPaymentWrite(signedIn(context), input.token),
		),
	),
	previewUndo: p.previewUndo.handler(
		serve(({ context, input }) =>
			payments.previewUndoPaymentWrite(signedIn(context), input.token),
		),
	),
};
