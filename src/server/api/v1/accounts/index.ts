import * as gap from "~/server/services/api-v1/gap-reads";
import {
	accountOps as ops,
	previewUndoAccountWrite,
	undoAccountWrite,
} from "~/server/services/api-v1/accounts/ops";
import { accountReads as read } from "~/server/services/api-v1/accounts/reads";
import type { LedgerCaller, MoneyOp } from "~/server/services/api-v1/money-op";
import { serve } from "../core/serve";
import { signedIn, type V1Context, v1 } from "../middleware";

const a = v1.accounts;

const h = <I, R>(run: (caller: LedgerCaller, input: I) => Promise<R>) =>
	serve(async ({ context, input }: { context: V1Context; input: I }) =>
		run(signedIn(context), input),
	);
const write = <I, V>(op: MoneyOp<I, V>) =>
	h((caller, input: I) => op.write(caller, input));
const preview = <I, V>(op: MoneyOp<I, V>) =>
	h((caller, input: I) => op.preview(caller, input));

export const accountsRouter = {
	runway: a.runway.handler(
		h((caller, input: { currency?: string }) =>
			gap.readRunway(caller, input.currency),
		),
	),
	list: a.list.handler(h(read.list)),
	netWorth: a.netWorth.handler(h(read.netWorth)),
	defaults: a.defaults.handler(h(read.defaults)),
	export: a.export.handler(h(read.export)),
	get: a.get.handler(h(read.get)),
	setDefault: a.setDefault.handler(h(read.setDefault)),
	create: a.create.handler(write(ops.create)),
	previewCreate: a.previewCreate.handler(preview(ops.create)),
	update: a.update.handler(write(ops.update)),
	previewUpdate: a.previewUpdate.handler(preview(ops.update)),
	close: a.close.handler(write(ops.close)),
	previewClose: a.previewClose.handler(preview(ops.close)),
	reopen: a.reopen.handler(write(ops.reopen)),
	previewReopen: a.previewReopen.handler(preview(ops.reopen)),
	delete: a.delete.handler(write(ops.delete)),
	previewDelete: a.previewDelete.handler(preview(ops.delete)),
	updateBalance: a.updateBalance.handler(write(ops.updateBalance)),
	previewUpdateBalance: a.previewUpdateBalance.handler(
		preview(ops.updateBalance),
	),
	setRateType: a.setRateType.handler(write(ops.setRateType)),
	previewSetRateType: a.previewSetRateType.handler(preview(ops.setRateType)),
	undo: a.undo.handler(
		h((caller, input: { token: string }) =>
			undoAccountWrite(caller, input.token),
		),
	),
	previewUndo: a.previewUndo.handler(
		h((caller, input: { token: string }) =>
			previewUndoAccountWrite(caller, input.token),
		),
	),
};
