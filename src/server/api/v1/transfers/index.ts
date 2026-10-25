import * as transfers from "~/server/services/api-v1/transfers";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const t = v1.transfers;

export const transfersRouter = {
	create: t.create.handler(
		serve(({ context, input }) =>
			transfers.createTransferWrite(signedIn(context), input),
		),
	),
	previewCreate: t.previewCreate.handler(
		serve(({ context, input }) =>
			transfers.previewCreateTransfer(signedIn(context), input),
		),
	),
	delete: t.delete.handler(
		serve(({ context, input }) =>
			transfers.removeTransfer(signedIn(context), input.id),
		),
	),
	previewDelete: t.previewDelete.handler(
		serve(({ context, input }) =>
			transfers.previewRemoveTransfer(signedIn(context), input.id),
		),
	),
	undo: t.undo.handler(
		serve(({ context, input }) =>
			transfers.undoTransferWrite(signedIn(context), input.token),
		),
	),
	previewUndo: t.previewUndo.handler(
		serve(({ context, input }) =>
			transfers.previewUndoTransferWrite(signedIn(context), input.token),
		),
	),
};
