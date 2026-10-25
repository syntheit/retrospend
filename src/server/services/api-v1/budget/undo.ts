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
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { accountChangeDto, spendUndo, toPreviewDto } from "../money-write";
import { staleAsConflict } from "../stale";
import { readUndo } from "../undo";
import { type GuardRef, guardedUndo } from "./guard";
import type { BudgetCaller } from "./serve";
import { wire } from "./wire";
import type { TokenInput, UndoOp } from "./write";

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

// biome-ignore lint/suspicious/noExplicitAny: each inverse has its own input and answer
type AnyMutation = MoneyMutation<any, any>;

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
	"draft.unapply": unapplyDraftMutation,
	"hidden_rows.revert": revertHiddenMutation,
	"debt_payment.delete": deleteDebtPayment,
};

const invalid = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

function open(caller: BudgetCaller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, "budget", token);
	const mutation = INVERSES[op as UndoOp];
	if (!mutation) throw invalid();
	const { args, guard, stamp } = input as TokenInput;
	return {
		kind: op as UndoOp,
		args,
		mutation: guardedUndo(mutation, guard as GuardRef | null, stamp),
	};
}

export async function undoBudgetWrite(caller: BudgetCaller, token: string) {
	const { kind, args, mutation } = open(caller, token);
	return spendUndo(caller, token, () =>
		staleAsConflict(async () => {
			const { value } = await forUser(caller.principal.userId).apply(
				mutation,
				args,
			);
			return { result: { kind, result: wire(value) }, redo: null };
		}),
	);
}

export async function previewUndoBudgetWrite(
	caller: BudgetCaller,
	token: string,
) {
	const { kind, args, mutation } = open(caller, token);
	const preview = await staleAsConflict(() =>
		forUser(caller.principal.userId).preview(mutation, args),
	);
	return {
		...toPreviewDto(preview),
		detail: { kind, result: wire(preview.value) },
	};
}
