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

const putInSchema = idSchema.nullish().meta({
	description: "The envelope to put it in. Left out: Not planned yet.",
});

/** Count Wealth money in the budget without selling it: a kept income, or units of an account. */
export const moveInSchema = z
	.union([
		z.object({
			expenseId: idSchema.meta({ description: "A kept income." }),
			putIn: putInSchema,
			date: daySchema.nullish(),
		}),
		z.object({
			id: z.uuid().meta({
				description:
					"A client-made id. Sending the same id twice does not count the money twice.",
			}),
			accountId: idSchema,
			units: amountTextSchema.meta({
				description: "How much of the account to count, in its own currency.",
			}),
			putIn: putInSchema,
			date: daySchema.nullish(),
		}),
	])
	.meta({ id: "MoveIn" });

export const movedInSchema = z
	.object({
		accountId: idSchema,
		expenseId: idSchema.nullable(),
		/** What the budget counts, in the home currency. */
		amount: moneySchema,
		/** Units of the account now counted in the budget. */
		countedUnits: z.string(),
		budgetSide: z.object({
			recorded: z.boolean(),
			reason: z.enum(["no_envelope_budget", "other_currency"]).nullable(),
		}),
	})
	.meta({ id: "MovedIn" });

export const moveInWriteSchema = z
	.object({ moved: movedInSchema, ...undoField })
	.meta({ id: "MoveInWrite" });

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
	moveIn: v1
		.route({
			method: "POST",
			path: "/income/move-in",
			operationId: "moveInIncome",
			tags: TAG,
			summary: "Count money you keep in Wealth in your budget",
			description:
				"No account moves: the money stays where it is and the budget gets its value. The undo token takes it out of the budget again.",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "income.moved_in" })
		.input(moveInSchema)
		.output(moveInWriteSchema),
	previewMoveIn: previewTwin({
		path: "/income/move-in",
		of: "POST /income/move-in",
		operationId: "previewMoveInIncome",
		tags: TAG,
		scope: "write:money",
		input: moveInSchema,
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
