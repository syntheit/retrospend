import * as payments from "~/server/services/api-v1/payments";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1.payments;

export const paymentsRouter = {
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
