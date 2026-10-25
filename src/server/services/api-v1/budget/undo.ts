import { TRPCError } from "@trpc/server";
import type { MovementResult, UndoInput } from "~/lib/schemas/envelope";
import {
	removeAdjustmentMutation,
	revertLimitMutation,
	revertStyleMutation,
	setBookPeriodMutation,
} from "~/server/services/envelope/book.mutation";
import { undoChangeMutation } from "~/server/services/envelope/crud.mutation";
import { revertHiddenMutation } from "~/server/services/envelope/migration.mutation";
import { undo as undoMovement } from "~/server/services/envelope/movement.service";
import { unapplyDraftMutation } from "~/server/services/envelope/plan.mutation";
import {
	setProjectRoutingMutation,
	setShareCategoryMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import {
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "~/server/services/envelope/verdict";
import type { MoneyMutation } from "~/server/services/preview/types";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { type AnyMutation, createUndoer } from "../money-op";
import { accountChangeDto } from "../money-write";
import { draftResultOut, fromEngine, v1Mutation } from "./amounts";
import {
	revertPayoffPlanMutation,
	setDebtTermsMutation,
	setGroupTargetMutation,
} from "./plan-mutations";
import type { BudgetCaller } from "./serve";
import type { UndoOp } from "./write";

type Tx = Parameters<typeof undoMovement>[0];

export type MovementUndoInput = { items: UndoInput[] };

/** Several undos in one transaction: the answer lists every row and keeps each envelope's first Left before and last after. */
function mergeMovements(parts: MovementResult[]): MovementResult {
	const first = parts[0];
	const last = parts[parts.length - 1];
	if (!first || !last) throw new TRPCError({ code: "BAD_REQUEST" });
	if (parts.length === 1) return first;
	const envelopes = new Map<string, MovementResult["envelopes"][number]>();
	for (const part of parts)
		for (const e of part.envelopes) {
			const seen = envelopes.get(e.id);
			envelopes.set(e.id, seen ? { ...seen, after: e.after } : e);
		}
	return {
		movements: parts.flatMap((p) => p.movements),
		envelopes: [...envelopes.values()],
		toAssign: { before: first.toAssign.before, after: last.toAssign.after },
	};
}

/** envelope.undo for a list of targets; a write whose rows span batches takes them all back at once. */
const undoMovementTargets: MoneyMutation<MovementUndoInput, MovementResult> = {
	id: "envelope.undo",
	touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx: Tx, input, actor) => {
		const parts: MovementResult[] = [];
		for (const item of input.items)
			parts.push(await undoMovement(tx, actor.userId, item, new Date()));
		return {
			value: mergeMovements(parts),
			undo: { kind: "revert", mutation: "envelope.undo", rows: [] },
		};
	},
};

/** The debt payment's transfer goes, with its legs, its interest expense and its budget side. */
const deleteDebtPayment: MoneyMutation<
	{ transferId: string },
	{ id: string; accounts: ReturnType<typeof accountChangeDto>[] }
> = {
	...deleteTransfer,
	run: async (tx, input, actor) => {
		const done = await deleteTransfer.run(tx, input, actor);
		return {
			value: {
				id: done.value.transferId,
				accounts: done.value.accounts.map(accountChangeDto),
			},
			undo: done.undo,
		};
	},
};

/** Each inverse a token can name, as the mutation that runs it. */
const INVERSES: Record<UndoOp, AnyMutation> = {
	"movement.undo": undoMovementTargets,
	"change.undo": undoChangeMutation,
	"limit.revert": revertLimitMutation,
	"style.revert": revertStyleMutation,
	"adjustment.remove": removeAdjustmentMutation,
	"share_category.set": setShareCategoryMutation,
	"project_routing.set": setProjectRoutingMutation,
	"forgive.undo": unforgiveMutation,
	"period.set": setBookPeriodMutation,
	"group_target.set": v1Mutation(setGroupTargetMutation, fromEngine),
	"debt_terms.set": setDebtTermsMutation,
	"payoff_plan.revert": revertPayoffPlanMutation,
	"draft.unapply": v1Mutation(unapplyDraftMutation, draftResultOut),
	"hidden_rows.revert": revertHiddenMutation,
	"debt_payment.delete": deleteDebtPayment,
};

const undoer = createUndoer<UndoOp, BudgetCaller>("budget", INVERSES);

export const undoBudgetWrite = (caller: BudgetCaller, token: string) =>
	undoer.undo(caller, token);

export const previewUndoBudgetWrite = (caller: BudgetCaller, token: string) =>
	undoer.preview(caller, token);
