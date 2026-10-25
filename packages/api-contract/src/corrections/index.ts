import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { amountTextSchema, previewTwin, undoInputSchema } from "../ledger";
import { personRefSchema } from "../people/schemas";
import { splitModeSchema, splitShareSchema } from "../shared-expenses";

const TAG = ["Corrections"];

const SCOPE = "write:expenses" as const;

export const FIX_REQUEST_STATUSES = [
	"PENDING",
	"ACCEPTED",
	"DECLINED",
	"FIXED",
	"CANCELLED",
] as const;

export const fixRequestStatusSchema = z
	.enum(FIX_REQUEST_STATUSES)
	.meta({ id: "FixRequestStatus" });

export const fixRequestSchema = z
	.object({
		id: idSchema,
		/** The split expense it is about. */
		expenseId: idSchema,
		requestedBy: personRefSchema,
		/** The person who can fix it: the one who added the expense. */
		asked: personRefSchema,
		message: z.string().nullable(),
		reply: z.string().nullable(),
		status: fixRequestStatusSchema,
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
		answeredAt: timestampSchema.nullable(),
	})
	.meta({ id: "FixRequest" });

export const lockStateSchema = z
	.object({
		expenseId: idSchema,
		locked: z.boolean(),
		/** SETTLED: a payment brought the scope to zero. PERIOD: a billing period closed. */
		reason: z.enum(["SETTLED", "PERIOD"]).nullable(),
		/** The person who added it corrects; everyone else on it asks to fix. */
		canCorrect: z.boolean(),
		canAskToFix: z.boolean(),
		/** This row corrects another split: undo the correction instead of editing it. */
		correctsId: idSchema.nullable(),
		/** Correction rows written for this split. */
		corrections: z.int().min(0),
	})
	.meta({ id: "LockState" });

export const lockStatesQuerySchema = z.object({
	ids: z
		.string()
		.min(1)
		.max(8000)
		.meta({
			description: "Comma-separated expense ids, at most 200.",
			examples: ["abc,def"],
		}),
});

/** Splits the `ids` query into expense ids. */
export function parseLockStateIds(ids: string): string[] {
	return [...new Set(ids.split(",").filter(Boolean))];
}

export const MAX_LOCK_STATE_IDS = 200;

export const expenseIdParamsSchema = z.object({ id: idSchema });

// ── Correct ─────────────────────────────────────────────────────────────────

export const correctExpenseSchema = z
	.object({
		/** The split being corrected (an original, never a correction row). */
		id: idSchema,
		correctionId: z.uuid().optional().meta({
			description:
				"A client-made id for the correction. Sending the same id twice writes nothing twice.",
		}),
		description: userText("sharedExpense.correctionTitle", 500).meta({
			description: 'The correction\'s own title, for example "Correction to ...".',
		}),
		amount: amountTextSchema.meta({
			description: "What the split should be now, in the expense's currency.",
		}),
		paidBy: personRefSchema,
		categoryId: idSchema.nullable(),
		splitMode: splitModeSchema,
		splitWith: z.array(splitShareSchema).min(1).max(100),
	})
	.meta({ id: "CorrectExpense" });

const resolvedRequestSchema = z.object({
	id: idSchema,
	previousStatus: fixRequestStatusSchema,
});

export const correctionWriteSchema = z
	.object({
		/** The correction rows written (empty when nothing changed). */
		correctionIds: z.array(idSchema),
		currency: z.string(),
		/** One line per person whose paid or share moved. Positive: more than before. */
		differences: z.array(
			z.object({
				person: personRefSchema,
				paid: moneySchema,
				share: moneySchema,
			}),
		),
		/** Open Ask to fix requests this correction answered. */
		resolvedRequests: z.array(resolvedRequestSchema),
		undo: undoTokenSchema.nullable().meta({
			description:
				"Valid for 24 hours, once. Send it to POST /corrections/undo. Null when nothing changed.",
		}),
	})
	.meta({ id: "CorrectionWrite" });

// ── Ask to fix ──────────────────────────────────────────────────────────────

export const askToFixSchema = z
	.object({
		/** The split expense to ask about. */
		id: idSchema,
		requestId: z.uuid().optional().meta({
			description:
				"A client-made id for the request. Sending the same id twice returns the same request.",
		}),
		message: userText("fixRequest.message", 1000).optional(),
	})
	.meta({ id: "AskToFix" });

export const respondToFixSchema = z
	.object({
		id: idSchema,
		response: z.enum(["accept", "decline"]),
		reply: userText("fixRequest.reply", 1000).optional(),
	})
	.meta({ id: "RespondToFix" });

export const fixRequestIdParamsSchema = z.object({ id: idSchema });

export const fixRequestWriteSchema = z
	.object({
		request: fixRequestSchema,
		/** The status before this write; null for a new request. */
		previousStatus: fixRequestStatusSchema.nullable(),
		undo: undoTokenSchema.meta({
			description:
				"Valid for 24 hours, once. Send it to POST /corrections/undo.",
		}),
	})
	.meta({ id: "FixRequestWrite" });

// ── Undo ────────────────────────────────────────────────────────────────────

export const correctionUndoResultSchema = z
	.object({
		/** What the token reverted: a correction, a new request, or an answer or cancel. */
		kind: z.enum([
			"correction.undo",
			"fixRequest.withdraw",
			"fixRequest.restore",
		]),
		/** The correction rows removed. */
		correctionIds: z.array(idSchema).optional(),
		/** The request withdrawn or put back. */
		request: fixRequestSchema.optional(),
		redo: undoTokenSchema.nullable().meta({
			description: "Always null: none of these can be put back again.",
		}),
	})
	.meta({ id: "CorrectionUndo" });

/**
 * Corrections and Ask to fix. A split a payment or a closed billing period
 * locked cannot be edited: its creator corrects it (the difference is
 * written as new rows, the original stays) and everyone else on it asks the
 * creator to fix it. Each write has a preview twin and an undo token for
 * POST /corrections/undo. Forgive is under /budget/forgive.
 */
export const correctionsContract = {
	correct: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/corrections",
			operationId: "correctSharedExpense",
			tags: TAG,
			summary: "Correct a settled split expense",
			description:
				"Say what the split should be now. The difference is written as correction rows dated today and the original stays as it was. Only the person who added the expense can; open Ask to fix requests are answered by it. The people on it are told.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "shared_expense.corrected" })
		.input(correctExpenseSchema)
		.output(correctionWriteSchema),
	previewCorrect: previewTwin({
		path: "/shared-expenses/{id}/corrections",
		of: "POST /shared-expenses/{id}/corrections",
		operationId: "previewCorrectSharedExpense",
		tags: TAG,
		scope: SCOPE,
		input: correctExpenseSchema,
	}),
	lockStates: v1
		.route({
			method: "GET",
			path: "/shared-expenses/lock-states",
			operationId: "getLockStates",
			tags: TAG,
			summary: "Which split expenses are locked and who may correct or ask",
			description: "Ids that are not yours to see are left out.",
		})
		.meta({ scope: "read" })
		.input(lockStatesQuerySchema)
		.output(z.object({ items: z.array(lockStateSchema) })),
	fixRequests: v1
		.route({
			method: "GET",
			path: "/shared-expenses/{id}/fix-requests",
			operationId: "listFixRequests",
			tags: TAG,
			summary: "The Ask to fix requests on a split expense",
			description: "Only the person who asked and the person asked see them.",
		})
		.meta({ scope: "read" })
		.input(expenseIdParamsSchema)
		.output(z.object({ items: z.array(fixRequestSchema) })),
	askToFix: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/fix-requests",
			operationId: "askToFix",
			tags: TAG,
			summary: "Ask the person who added an expense to fix it",
			description:
				"For anyone on the split but its creator, who is on Retrospend. One open request per person.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "fix_request.created" })
		.input(askToFixSchema)
		.output(fixRequestWriteSchema),
	previewAskToFix: previewTwin({
		path: "/shared-expenses/{id}/fix-requests",
		of: "POST /shared-expenses/{id}/fix-requests",
		operationId: "previewAskToFix",
		tags: TAG,
		scope: SCOPE,
		input: askToFixSchema,
	}),
	respondToFix: v1
		.route({
			method: "POST",
			path: "/fix-requests/{id}/respond",
			operationId: "respondToFix",
			tags: TAG,
			summary: "Accept or decline a request to fix your expense",
			description:
				"Only the person asked, and only while it waits. Accepting does not edit the expense: edit or correct it and the request is marked fixed.",
		})
		.meta({ scope: SCOPE, event: "fix_request.answered" })
		.input(respondToFixSchema)
		.output(fixRequestWriteSchema),
	previewRespondToFix: previewTwin({
		path: "/fix-requests/{id}/respond",
		of: "POST /fix-requests/{id}/respond",
		operationId: "previewRespondToFix",
		tags: TAG,
		scope: SCOPE,
		input: respondToFixSchema,
	}),
	cancelFix: v1
		.route({
			method: "POST",
			path: "/fix-requests/{id}/cancel",
			operationId: "cancelFixRequest",
			tags: TAG,
			summary: "Cancel a request you made",
			description: "Only the person who asked, and only while it is open.",
		})
		.meta({ scope: SCOPE, event: "fix_request.cancelled" })
		.input(fixRequestIdParamsSchema)
		.output(fixRequestWriteSchema),
	previewCancelFix: previewTwin({
		path: "/fix-requests/{id}/cancel",
		of: "POST /fix-requests/{id}/cancel",
		operationId: "previewCancelFixRequest",
		tags: TAG,
		scope: SCOPE,
		input: fixRequestIdParamsSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/corrections/undo",
			operationId: "undoCorrectionWrite",
			tags: TAG,
			summary: "Revert a correction or an Ask to fix write from its undo token",
			description:
				"Tokens from the correction, ask, answer and cancel writes. Only the latest correction of a split can be undone, and only while no payment has settled on top of it. A request can be withdrawn only while nobody answered. A token is for its user, works once and expires after 24 hours.",
		})
		.meta({ scope: SCOPE, event: "correction.undone" })
		.input(undoInputSchema)
		.output(correctionUndoResultSchema),
	previewUndo: previewTwin({
		path: "/corrections/undo",
		of: "POST /corrections/undo",
		operationId: "previewUndoCorrectionWrite",
		tags: TAG,
		scope: SCOPE,
		input: undoInputSchema,
	}),
};
