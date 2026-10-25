import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idSchema } from "../core";
import {
	accountChangeSchema,
	amountTextSchema,
	daySchema,
	previewTwin,
	ratePairSchema,
	undoField,
	undoInputSchema,
} from "../ledger";

const TAG = ["Transfers"];

export const TRANSFER_KINDS = [
	"TRANSFER",
	"EXCHANGE",
	"CARD_PAYMENT",
	"WITHDRAWAL",
	"DEBT_PAYMENT",
] as const;

export const transferKindSchema = z
	.enum(TRANSFER_KINDS)
	.meta({ id: "TransferKind" });

export const createTransferSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second move.",
		}),
		fromAccountId: idSchema.nullable().meta({
			description: "Null is Not tracked: money outside your accounts.",
		}),
		toAccountId: idSchema.nullable(),
		fromCurrency: currencyCodeSchema.nullish().meta({
			description: "Needed when that side is Not tracked.",
		}),
		toCurrency: currencyCodeSchema.nullish(),
		fromAmount: amountTextSchema,
		toAmount: amountTextSchema.nullish().meta({
			description:
				"Exchange: what arrived, as typed. Omitted: at the reference rate.",
		}),
		kind: transferKindSchema.nullish(),
		date: daySchema.nullish().meta({ description: "Today when omitted." }),
		note: userText("transfer.note", 500).nullish(),
		fee: z
			.object({ amount: amountTextSchema, accountId: idSchema.nullish() })
			.nullish()
			.meta({
				description:
					"A bank fee, booked as its own expense from this account (default: the source).",
			}),
		envelopeId: idSchema.nullish().meta({
			description:
				"Leaving the budget: the envelope it comes from (null is To assign).",
		}),
		putIn: idSchema.nullish().meta({
			description:
				"Entering the budget: the envelope it goes into (null is To assign).",
		}),
	})
	.meta({ id: "CreateTransfer" });

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
