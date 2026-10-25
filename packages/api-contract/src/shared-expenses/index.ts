import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema } from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idSchema } from "../core";
import {
	amountTextSchema,
	daySchema,
	previewTwin,
	undoField,
	undoInputSchema,
} from "../ledger";
import { personRefSchema } from "../people/schemas";
import { sharedExpenseExtrasContract } from "./extras";

export * from "./extras";

const TAG = ["Shared expenses"];

export const SPLIT_MODES = ["EQUAL", "EXACT", "PERCENTAGE", "SHARES"] as const;

export const splitModeSchema = z.enum(SPLIT_MODES).meta({ id: "SplitMode" });

/** A share as decimal text, zero allowed (a payer who owes nothing of it). */
const shareTextSchema = z
	.string()
	.regex(/^\d{1,11}(\.\d{1,8})?$/, "Use digits and at most 8 decimals")
	.meta({ id: "ShareText", examples: ["25.50", "0"] });

const percentTextSchema = z
	.string()
	.regex(/^\d{1,3}(\.\d{1,4})?$/, "Use a percent like 33.3333")
	.meta({ id: "PercentText", examples: ["50"] });

/** One person in the split. Which share field counts depends on `splitMode`. */
export const splitShareSchema = personRefSchema
	.extend({
		shareAmount: shareTextSchema.optional().meta({
			description: "EXACT: what this person owes, in the expense's currency.",
		}),
		sharePercentage: percentTextSchema.optional().meta({
			description: "PERCENTAGE: their percent of the amount.",
		}),
		shareUnits: z.int().positive().optional().meta({
			description: "SHARES: their number of shares.",
		}),
	})
	.meta({ id: "SplitShare" });

const sharedFields = {
	amount: amountTextSchema,
	currency: currencyCodeSchema,
	description: userText("shared_expense.description", 500),
	categoryId: idSchema.optional(),
	date: daySchema,
	notes: userText("shared_expense.notes", 5000).nullish(),
	paidBy: personRefSchema,
	splitWith: z.array(splitShareSchema).min(1).max(200),
	splitMode: splitModeSchema,
	projectId: idSchema.nullish().meta({
		description: "Null or left out: an expense outside projects.",
	}),
};

export const createSharedExpenseSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second expense.",
		}),
		...sharedFields,
	})
	.meta({ id: "CreateSharedExpense" });

/** A full replacement: a note, category or project left out is cleared. */
export const updateSharedExpenseSchema = z
	.object({ id: idSchema, ...sharedFields })
	.meta({ id: "UpdateSharedExpense" });

export const deleteSharedExpenseSchema = z
	.object({
		id: idSchema,
		confirmUnsettled: z.boolean().optional().meta({
			description:
				"Delete even though it erases a debt or leaves the payer owing. Without it that is a conflict.",
		}),
		settled: z.enum(["KEEP_CREDIT", "VOID_PAYMENT"]).optional().meta({
			description:
				"Payments already cover it: keep them as a credit, or void them in the same action.",
		}),
	})
	.meta({ id: "DeleteSharedExpense" });

export const sharedExpenseWriteSchema = z
	.object({
		id: idSchema,
		/** The open billing period it joined starts after its date. */
		backdatedPeriod: z.string().nullable(),
		...undoField,
	})
	.meta({ id: "SharedExpenseWrite" });

export const sharedExpenseDeleteSchema = z
	.object({ id: idSchema })
	.meta({ id: "SharedExpenseDelete" });

export const sharedExpenseUndoResultSchema = z
	.object({
		id: idSchema,
		/** Puts the undo back. Null for the undo of an add: a deleted split has no redo. */
		redo: undoTokenSchema.nullable(),
	})
	.meta({ id: "SharedExpenseUndo" });

export const VERIFICATION_STATUSES = [
	"PENDING",
	"ACCEPTED",
	"REJECTED",
	"AUTO_ACCEPTED",
] as const;

export const verificationSchema = z
	.object({
		id: idSchema,
		/** Where the expense stands overall. */
		status: z.enum(["pending", "disputed", "active"]),
		participants: z.array(
			z.object({
				type: z.enum(["user", "guest", "shadow"]),
				id: idSchema,
				status: z.enum(VERIFICATION_STATUSES),
			}),
		),
	})
	.meta({ id: "SharedExpenseVerification" });

export const rejectSharedExpenseSchema = z
	.object({
		id: idSchema,
		reason: userText("shared_expense.reject_reason", 500).optional(),
	})
	.meta({ id: "RejectSharedExpense" });

/**
 * Splits with people. Each write has a preview twin and an undo token for
 * POST /shared-expenses/undo. Deleting a split changes other people's
 * balances, so it has no undo: it is confirmed and previewed instead. Reading
 * them: GET /people/{type}/{id}/ledger, GET /projects/{id} and GET /expenses.
 */
export const sharedExpensesContract = {
	...sharedExpenseExtrasContract,
	create: v1
		.route({
			method: "POST",
			path: "/shared-expenses",
			operationId: "createSharedExpense",
			tags: TAG,
			summary: "Add an expense split with people",
			description:
				"The people on it are told. Anyone who is not you verifies their share unless the project accepts splits by itself.",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "shared_expense.created" })
		.input(createSharedExpenseSchema)
		.output(sharedExpenseWriteSchema),
	previewCreate: previewTwin({
		path: "/shared-expenses",
		of: "POST /shared-expenses",
		operationId: "previewCreateSharedExpense",
		tags: TAG,
		scope: "write:expenses",
		input: createSharedExpenseSchema,
	}),
	update: v1
		.route({
			method: "PUT",
			path: "/shared-expenses/{id}",
			operationId: "updateSharedExpense",
			tags: TAG,
			summary: "Replace a split expense",
			description:
				"Every field is sent. The people on it verify again. Refused for a split that payments locked, and for anyone the project does not let edit it.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.updated" })
		.input(updateSharedExpenseSchema)
		.output(sharedExpenseWriteSchema),
	previewUpdate: previewTwin({
		path: "/shared-expenses/{id}",
		of: "PUT /shared-expenses/{id}",
		operationId: "previewUpdateSharedExpense",
		tags: TAG,
		scope: "write:expenses",
		input: updateSharedExpenseSchema,
	}),
	delete: v1
		.route({
			method: "DELETE",
			path: "/shared-expenses/{id}",
			operationId: "deleteSharedExpense",
			tags: TAG,
			summary: "Delete a split expense",
			description:
				"A delete that would erase a debt or leave the payer owing needs confirmUnsettled or settled, and is a conflict without it.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.deleted" })
		.input(deleteSharedExpenseSchema)
		.output(sharedExpenseDeleteSchema),
	previewDelete: previewTwin({
		path: "/shared-expenses/{id}",
		twinPath: "/shared-expenses/{id}/delete/preview",
		of: "DELETE /shared-expenses/{id}",
		operationId: "previewDeleteSharedExpense",
		tags: TAG,
		scope: "write:expenses",
		input: deleteSharedExpenseSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/shared-expenses/undo",
			operationId: "undoSharedExpenseWrite",
			tags: TAG,
			summary: "Revert a split expense write from its undo token",
			description:
				"Tokens from create and update. Undoing an add right away takes the notices back. A token is for its user and expires after 24 hours.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.undone" })
		.input(undoInputSchema)
		.output(sharedExpenseUndoResultSchema),
	previewUndo: previewTwin({
		path: "/shared-expenses/undo",
		of: "POST /shared-expenses/undo",
		operationId: "previewUndoSharedExpenseWrite",
		tags: TAG,
		scope: "write:expenses",
		input: undoInputSchema,
	}),
	accept: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/accept",
			operationId: "acceptSharedExpense",
			tags: TAG,
			summary: "Accept your share of a split expense",
			description: "Accepting twice answers the current state.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.accepted" })
		.input(z.object({ id: idSchema }))
		.output(verificationSchema),
	reject: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/reject",
			operationId: "rejectSharedExpense",
			tags: TAG,
			summary: "Reject your share of a split expense",
			description: "The person who added it is told.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.rejected" })
		.input(rejectSharedExpenseSchema)
		.output(verificationSchema),
};
