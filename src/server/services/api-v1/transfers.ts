import type { createTransferSchema } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import { transferView } from "~/server/services/entry/views";
import {
	type CreateTransferInput,
	createTransfer,
	type TransferValue,
} from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import type { Caller } from "./caller";
import {
	accountChangeDto,
	applyWrite,
	previewWrite,
	spendUndo,
	undoFor,
} from "./money-write";
import { readUndo } from "./undo";

/** v1 adapters for /transfers. The mutations are the web's own (transfers/*.mutation.ts). */

type LedgerCaller = Caller & { timeZone: string };
type Input = z.infer<typeof createTransferSchema>;
type Created = TransferValue;

const FAMILY = "transfer" as const;

const createInput = (
	caller: LedgerCaller,
	input: Input,
): CreateTransferInput => ({
	...input,
	timeZone: caller.timeZone,
});

export function transferResult(value: Created) {
	const v = transferView(value);
	const { budget } = v;
	return {
		id: v.transferId,
		kind: v.kind,
		from: v.from,
		to: v.to,
		rate: v.rate,
		vsReference: v.vsReference,
		referenceRateType: v.referenceRateType,
		reference: v.reference,
		accounts: [...v.accounts],
		budget: {
			effect: budget.effect,
			amount:
				"minor" in budget
					? { minor: budget.minor, currency: budget.currency }
					: null,
			recorded: budget.side.recorded,
			recordedReason: budget.side.reason,
		},
		feeExpenseId: v.feeExpenseId,
	};
}

export async function createTransferWrite(caller: LedgerCaller, input: Input) {
	const value = await applyWrite(
		caller,
		createTransfer,
		createInput(caller, input),
	);
	return {
		transfer: transferResult(value),
		undo: undoFor(caller, FAMILY, "transfer.delete", {
			transferId: value.transferId,
		}),
	};
}

export const previewCreateTransfer = (caller: LedgerCaller, input: Input) =>
	previewWrite(caller, createTransfer, createInput(caller, input));

export async function removeTransfer(caller: LedgerCaller, id: string) {
	const value = await applyWrite(caller, deleteTransfer, { transferId: id });
	return {
		id: value.transferId,
		accounts: value.accounts.map(accountChangeDto),
		undo: undoFor(caller, FAMILY, "transfer.create", value.recreate),
	};
}

export const previewRemoveTransfer = (caller: LedgerCaller, id: string) =>
	previewWrite(caller, deleteTransfer, { transferId: id });

// ── Undo ────────────────────────────────────────────────────────────────────

/** The inverse call a token names, ready to preview or to apply. */
function inverseOf(caller: LedgerCaller, op: string, input: unknown) {
	if (op === "transfer.delete") {
		const args = input as { transferId: string };
		return {
			preview: () => previewWrite(caller, deleteTransfer, args),
			apply: async () => {
				const value = await applyWrite(caller, deleteTransfer, args);
				return {
					id: value.transferId,
					accounts: value.accounts.map(accountChangeDto),
					redo: undoFor(caller, FAMILY, "transfer.create", value.recreate),
				};
			},
		};
	}
	if (op === "transfer.create") {
		const args = {
			...(input as CreateTransferInput),
			timeZone: caller.timeZone,
		};
		return {
			preview: () => previewWrite(caller, createTransfer, args),
			apply: async () => {
				const value = await applyWrite(caller, createTransfer, args);
				return {
					id: value.transferId,
					accounts: transferResult(value).accounts,
					redo: undoFor(caller, FAMILY, "transfer.delete", {
						transferId: value.transferId,
					}),
				};
			},
		};
	}
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});
}

export function undoTransferWrite(caller: LedgerCaller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return spendUndo(caller, token, () => inverseOf(caller, op, input).apply());
}

export function previewUndoTransferWrite(caller: LedgerCaller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return inverseOf(caller, op, input).preview();
}
