import * as z from "zod";
import { amountTextSchema } from "../common/amount-text";
import { daySchema } from "../common/day";
import { currencyCodeSchema } from "../common/money";
import { userText } from "../common/user-text";
import { idSchema } from "../core";

/**
 * The transfer create body, apart from the routes, so the device can check a
 * body against it without the route builder (the accounts' schemas.ts does
 * the same).
 */

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
				"A client-made id. A taken id is 409 id_taken and nothing is written, so the same id twice is a conflict, not a second move.",
		}),
		fromLegId: z.uuid().optional().meta({
			description:
				"A client-made id for the source's leg. A taken id is 409 id_taken and nothing is written.",
		}),
		toLegId: z.uuid().optional().meta({
			description: "A client-made id for the destination's leg.",
		}),
		feeExpenseId: z.uuid().optional().meta({
			description:
				"A client-made id for the fee's expense; used only when a fee is booked.",
		}),
		feeLegId: z.uuid().optional().meta({
			description:
				"A client-made id for the fee's leg; used only when a fee is booked.",
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
