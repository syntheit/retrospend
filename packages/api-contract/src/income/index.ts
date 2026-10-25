import * as z from "zod";
import { v1 } from "../common/meta";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idParamsSchema, idSchema } from "../core";
import {
	accountChangeSchema,
	amountTextSchema,
	daySchema,
	previewTwin,
	rateTextSchema,
	undoField,
	undoInputSchema,
} from "../ledger";

const TAG = ["Income"];

export const FREQUENCIES = [
	"WEEKLY",
	"BIWEEKLY",
	"MONTHLY",
	"QUARTERLY",
	"YEARLY",
] as const;

export const frequencySchema = z
	.enum(FREQUENCIES)
	.meta({ id: "RecurringFrequency" });

/** Where Use my plan puts what the targets leave over. */
export const planRestSchema = z
	.enum(["LEAVE", "SAVE", "NEXT_MONTH"])
	.meta({ id: "PlanRest" });

export const addIncomeSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second income.",
		}),
		title: userText("income.title", 191),
		amount: amountTextSchema,
		currency: currencyCodeSchema,
		rateType: rateTypeSchema.nullish(),
		customRate: rateTextSchema.nullish(),
		categoryId: idSchema.nullish(),
		description: userText("income.description", 1000).nullish(),
		date: daySchema.nullish().meta({ description: "Today when omitted." }),
		into: idSchema.nullish().meta({
			description:
				"The account it lands in. Without one it is in the budget only.",
		}),
		keep: z.boolean().nullish().meta({
			description:
				"Keep it in Wealth, out of To assign. Default: kept when the account is outside the budget.",
		}),
		repeats: z
			.object({
				frequency: frequencySchema,
				next: daySchema.nullish(),
			})
			.nullish()
			.meta({
				description: "Also create the recurring income that repeats it.",
			}),
		usePlan: z.boolean().optional().meta({
			description:
				"Use my plan: assign the money by the envelope plan in the same action.",
		}),
		planRest: planRestSchema.optional(),
	})
	.meta({ id: "AddIncome" });

export const planLineSchema = z.object({
	envelopeId: idSchema,
	month: z.int(),
	amount: moneySchema,
	step: z.enum([
		"PLAN",
		"OVERSPENT",
		"BILL",
		"GROUP",
		"MONTHLY",
		"SAVINGS",
		"REST",
	]),
});

/** What Use my plan did. Not applied is a result, not an error. */
export const planResultSchema = z
	.object({
		applied: z.boolean(),
		reason: z
			.enum([
				"no_envelope_budget",
				"not_requested",
				"nothing_to_assign",
				"other_currency",
			])
			.nullable(),
		batchId: idSchema.nullable(),
		lines: z.array(planLineSchema),
		/** What stays Not planned yet. */
		rest: moneySchema.nullable(),
		restChoice: planRestSchema,
	})
	.meta({ id: "PlanResult" });

export const incomeResultSchema = z
	.object({
		/** The money-in entry; read it at GET /expenses/{id}. */
		id: idSchema,
		/** Its value in the home currency at its own rate; null when no rate exists. */
		booked: moneySchema.nullable(),
		account: accountChangeSchema.nullable(),
		/** Kept in Wealth (out of To assign) or counted in the budget. */
		kept: z.boolean(),
		/** The recurring income created with `repeats`. */
		templateId: idSchema.nullable(),
		plan: planResultSchema,
	})
	.meta({ id: "IncomeResult" });

export const incomeWriteSchema = z
	.object({ income: incomeResultSchema, ...undoField })
	.meta({ id: "IncomeWrite" });

export const deleteIncomeSchema = idParamsSchema
	.extend({
		templateId: idSchema.optional().meta({
			description:
				"The recurring income created with it, deleted too when it is this entry's.",
		}),
	})
	.meta({ id: "DeleteIncome" });

export const incomeDeleteSchema = z
	.object({
		id: idSchema,
		accounts: z.array(accountChangeSchema),
		...undoField,
	})
	.meta({ id: "IncomeDelete" });

export const incomeUndoResultSchema = z
	.object({
		id: idSchema,
		accounts: z.array(accountChangeSchema),
		redo: undoTokenSchema,
	})
	.meta({ id: "IncomeUndo" });

/**
 * Money in. Reading an income entry is GET /expenses/{id}, listing them is
 * GET /expenses?filter=kind=in. The writes are money writes: each has a
 * preview twin and an undo token for POST /income/undo.
 */
export const incomeContract = {
	create: v1
		.route({
			method: "POST",
			path: "/income",
			operationId: "createIncome",
			tags: TAG,
			summary: "Add income",
			description:
				"One money-in entry, into an account or not, optionally repeating, optionally assigned by the envelope plan (usePlan).",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "income.created" })
		.input(addIncomeSchema)
		.output(incomeWriteSchema),
	previewCreate: previewTwin({
		path: "/income",
		of: "POST /income",
		operationId: "previewCreateIncome",
		tags: TAG,
		scope: "write:money",
		input: addIncomeSchema,
	}),
	delete: v1
		.route({
			method: "DELETE",
			path: "/income/{id}",
			operationId: "deleteIncome",
			tags: TAG,
			summary: "Delete an income entry",
			description:
				"Takes its account change and the plan it assigned back. Refused once it was moved into the budget.",
		})
		.meta({ scope: "write:money", event: "income.deleted" })
		.input(deleteIncomeSchema)
		.output(incomeDeleteSchema),
	previewDelete: previewTwin({
		path: "/income/{id}",
		of: "DELETE /income/{id}",
		operationId: "previewDeleteIncome",
		tags: TAG,
		scope: "write:money",
		input: deleteIncomeSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/income/undo",
			operationId: "undoIncomeWrite",
			tags: TAG,
			summary: "Revert an income write from its undo token",
		})
		.meta({ scope: "write:money", event: "income.undone" })
		.input(undoInputSchema)
		.output(incomeUndoResultSchema),
	previewUndo: previewTwin({
		path: "/income/undo",
		of: "POST /income/undo",
		operationId: "previewUndoIncomeWrite",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
