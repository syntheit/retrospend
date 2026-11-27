import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { idSchema } from "../core";
import {
	createTransferSchema,
	TRANSFER_KINDS,
	transferKindSchema,
} from "./schemas";

import {
	accountChangeSchema,
	previewTwin,
	ratePairSchema,
	undoField,
	undoInputSchema,
} from "../ledger";

export { createTransferSchema, TRANSFER_KINDS, transferKindSchema };

const TAG = ["Transfers"];

export const budgetEffectSchema = z
	.object({
		effect: z.enum(["none", "leaves", "enters", "counted", "unavailable"]),
		/** The in-budget amount that leaves or enters; null for the other effects. */
		amount: moneySchema.nullable(),
		/** Whether the budget's own record was written. */
		recorded: z.boolean(),
		recordedReason: z.enum(["no_envelope_budget", "other_currency"]).nullable(),
	})
	.meta({ id: "TransferBudgetEffect" });

export const transferResultSchema = z
	.object({
		id: idSchema,
		legs: z
			.object({
				from: idSchema,
				to: idSchema,
				fee: idSchema.nullable().meta({
					description: "Null when no fee was booked.",
				}),
			})
			.meta({ description: "The ids of the legs this move wrote." }),
		kind: transferKindSchema,
		from: moneySchema,
		to: moneySchema,
		/** Exchange: the rate the two amounts make. */
		rate: ratePairSchema.nullable(),
		/** Against the reference rate in home money: negative is less than the reference. */
		vsReference: moneySchema.nullable(),
		referenceRateType: z.string().nullable(),
		reference: ratePairSchema.nullable(),
		accounts: z.array(accountChangeSchema),
		budget: budgetEffectSchema,
		feeExpenseId: idSchema.nullable(),
	})
	.meta({ id: "TransferResult" });

export const transferWriteSchema = z
	.object({ transfer: transferResultSchema, ...undoField })
	.meta({ id: "TransferWrite" });

export const transferIdParamsSchema = z.object({ id: idSchema });

export const transferDeleteSchema = z
	.object({
		id: idSchema,
		accounts: z.array(accountChangeSchema),
		...undoField,
	})
	.meta({ id: "TransferDelete" });

export const transferUndoResultSchema = z
	.object({
		id: idSchema,
		accounts: z.array(accountChangeSchema),
		redo: undoTokenSchema,
	})
	.meta({ id: "TransferUndo" });

/**
 * Moves between your own places: transfer, exchange, card payment,
 * withdrawal and debt payment (`kind`). Each write has a preview twin and an
 * undo token for POST /transfers/undo. There is no list route: transfers
 * appear in GET /expenses?filter=kind=transfer.
 */
export const transfersContract = {
	create: v1
		.route({
			method: "POST",
			path: "/transfers",
			operationId: "createTransfer",
			tags: TAG,
			summary: "Move money between two of your places",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "transfer.created" })
		.input(createTransferSchema)
		.output(transferWriteSchema),
	previewCreate: previewTwin({
		path: "/transfers",
		of: "POST /transfers",
		operationId: "previewCreateTransfer",
		tags: TAG,
		scope: "write:money",
		input: createTransferSchema,
	}),
	delete: v1
		.route({
			method: "DELETE",
			path: "/transfers/{id}",
			operationId: "deleteTransfer",
			tags: TAG,
			summary: "Delete a transfer, its legs and its fee",
		})
		.meta({ scope: "write:money", event: "transfer.deleted" })
		.input(transferIdParamsSchema)
		.output(transferDeleteSchema),
	previewDelete: previewTwin({
		path: "/transfers/{id}",
		of: "DELETE /transfers/{id}",
		operationId: "previewDeleteTransfer",
		tags: TAG,
		scope: "write:money",
		input: transferIdParamsSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/transfers/undo",
			operationId: "undoTransferWrite",
			tags: TAG,
			summary: "Revert a transfer write from its undo token",
		})
		.meta({ scope: "write:money", event: "transfer.undone" })
		.input(undoInputSchema)
		.output(transferUndoResultSchema),
	previewUndo: previewTwin({
		path: "/transfers/undo",
		of: "POST /transfers/undo",
		operationId: "previewUndoTransferWrite",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
