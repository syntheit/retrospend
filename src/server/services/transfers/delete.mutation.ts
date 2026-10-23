/**
 * transfer.delete, the undo of transfer.create: the move, its legs, its fee
 * expense and the counted units it moved (D4) all go back. Its own undo is
 * transfer.create with `recreate`, the same id and the amounts as typed.
 */
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import { type AccountChange, reverseLegs } from "../accounts/ledger";
import { type CreateTransferInput, TRANSFER_FIGURES } from "./create.mutation";

type Tx = Prisma.TransactionClient;

export interface DeleteTransferInput {
	readonly transferId: string;
}

export interface DeletedTransfer {
	readonly transferId: string;
	readonly accounts: readonly AccountChange[];
	/** transfer.create with this input brings the move back as it was. */
	readonly recreate: CreateTransferInput;
}

async function recreateInput(
	tx: Tx,
	transfer: Prisma.TransferGetPayload<object>,
): Promise<CreateTransferInput> {
	const feeLeg = transfer.feeExpenseId
		? await tx.accountLeg.findFirst({
				where: { transferId: transfer.id, source: "FEE" },
				select: { accountId: true, amount: true },
			})
		: null;
	return {
		id: transfer.id,
		fromAccountId: transfer.fromAccountId,
		toAccountId: transfer.toAccountId,
		fromCurrency: transfer.fromCurrency,
		toCurrency: transfer.toCurrency,
		fromAmount: transfer.fromAmount.toString(),
		toAmount: transfer.toAmount.toString(),
		kind: transfer.kind,
		date: transfer.date.toISOString().slice(0, 10),
		note: transfer.note,
		fee: feeLeg
			? { amount: feeLeg.amount.abs().toString(), accountId: feeLeg.accountId }
			: null,
	};
}

export async function deleteTransferIn(
	tx: Tx,
	userId: string,
	input: DeleteTransferInput,
): Promise<DeletedTransfer> {
	const transfer = await tx.transfer.findFirst({
		where: { id: input.transferId, userId },
	});
	if (!transfer) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
	}
	const recreate = await recreateInput(tx, transfer);
	const accounts = await reverseLegs(tx, { transferId: transfer.id });
	if (transfer.fromAccountId && transfer.countedFromUnits.gt(0)) {
		await tx.assetAccount.update({
			where: { id: transfer.fromAccountId },
			data: { countedUnits: { increment: transfer.countedFromUnits } },
		});
	}
	if (transfer.toAccountId && transfer.countedToUnits.gt(0)) {
		// The counted units may have moved on since; never below zero.
		await tx.$executeRaw`UPDATE "asset_account"
			SET "countedUnits" = GREATEST(0, "countedUnits" - ${transfer.countedToUnits})
			WHERE "id" = ${transfer.toAccountId}`;
	}
	// Never more counted than an account holds (the cap the leg trigger applies).
	for (const id of [transfer.fromAccountId, transfer.toAccountId]) {
		if (id) await tx.$executeRaw`SELECT account_cap_counted(${id})`;
	}
	await tx.transfer.delete({ where: { id: transfer.id } });
	if (transfer.feeExpenseId) {
		await tx.expense.deleteMany({
			where: { id: transfer.feeExpenseId, userId },
		});
	}
	return { transferId: transfer.id, accounts, recreate };
}

export const deleteTransfer: MoneyMutation<
	DeleteTransferInput,
	DeletedTransfer
> = {
	id: "transfer.delete",
	touches: TRANSFER_FIGURES,
	run: async (tx, input, actor) => {
		const value = await deleteTransferIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "transfer.create",
				rows: [{ table: "transfer", id: value.transferId }],
			},
		};
	},
};
