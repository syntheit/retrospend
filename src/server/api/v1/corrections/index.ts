import * as corrections from "~/server/services/api-v1/corrections";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const c = v1.corrections;

export const correctionsRouter = {
	correct: c.correct.handler(
		serve(({ context, input }) =>
			corrections.correctExpense(signedIn(context), input),
		),
	),
	previewCorrect: c.previewCorrect.handler(
		serve(({ context, input }) =>
			corrections.previewCorrectExpense(signedIn(context), input),
		),
	),
	lockStates: c.lockStates.handler(
		serve(({ context, input }) =>
			corrections.readLockStates(signedIn(context), input.ids),
		),
	),
	fixRequests: c.fixRequests.handler(
		serve(({ context, input }) =>
			corrections.listFixRequests(signedIn(context), input.id),
		),
	),
	askToFix: c.askToFix.handler(
		serve(({ context, input }) =>
			corrections.askToFix(signedIn(context), input),
		),
	),
	previewAskToFix: c.previewAskToFix.handler(
		serve(({ context, input }) =>
			corrections.previewAskToFix(signedIn(context), input),
		),
	),
	respondToFix: c.respondToFix.handler(
		serve(({ context, input }) =>
			corrections.respondToFix(signedIn(context), input),
		),
	),
	previewRespondToFix: c.previewRespondToFix.handler(
		serve(({ context, input }) =>
			corrections.previewRespondToFix(signedIn(context), input),
		),
	),
	cancelFix: c.cancelFix.handler(
		serve(({ context, input }) =>
			corrections.cancelFix(signedIn(context), input.id),
		),
	),
	previewCancelFix: c.previewCancelFix.handler(
		serve(({ context, input }) =>
			corrections.previewCancelFix(signedIn(context), input.id),
		),
	),
	undo: c.undo.handler(
		serve(({ context, input }) =>
			corrections.undoCorrectionWrite(signedIn(context), input.token),
		),
	),
	previewUndo: c.previewUndo.handler(
		serve(({ context, input }) =>
			corrections.previewUndoCorrectionWrite(signedIn(context), input.token),
		),
	),
};
