import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { daySchema, previewTwin, undoField } from "../ledger";
import { participantTypeSchema } from "../people/schemas";

const TAG = ["Shared expenses"];

const personSchema = z.object({
	type: participantTypeSchema,
	id: idSchema,
	name: z.string(),
	imageUrl: z.string().nullable(),
});

export const sharedExpenseDetailSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		amount: moneySchema,
		date: daySchema,
		notes: z.string().nullable(),
		splitMode: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]),
		project: z.object({ id: idSchema, name: z.string() }).nullable(),
		category: z
			.object({ id: idSchema, name: z.string(), color: z.string() })
			.nullable(),
		/** A payment settled it, or its billing period closed. */
		locked: z.boolean(),
		paidBy: personSchema,
		/** Who added it, which decides who edits and who asks for a fix. */
		createdBy: personSchema.extend({ you: z.boolean() }),
		splits: z.array(
			personSchema.extend({
				share: moneySchema,
				/** Percent as decimal text, for a percentage split. */
				percentage: z.string().nullable(),
				/** Number of shares, for a shares split. */
				units: z.int().nullable(),
				verification: z.enum(["PENDING", "ACCEPTED", "REJECTED", "AUTO_ACCEPTED"]),
			}),
		),
		/** Someone besides you has accepted their share. */
		hasVerifiedParticipants: z.boolean(),
		canEdit: z.boolean(),
		canDelete: z.boolean(),
		/** Why you cannot edit or delete it; null when you can. */
		reason: z.string().nullable(),
	})
	.meta({ id: "SharedExpenseDetail" });

export const bulkAcceptSchema = z
	.object({
		ids: z
			.array(idSchema)
			.min(1)
			.max(100)
			.meta({ description: "Split expenses whose share you accept." }),
	})
	.meta({ id: "BulkAcceptSharedExpenses" });

export const outgoingPendingSchema = z
	.object({
		items: z.array(
			personSchema.extend({
				expenses: z.array(
					z.object({
						id: idSchema,
						title: z.string(),
						amount: moneySchema,
						date: daySchema,
						project: z.string().nullable(),
					}),
				),
			}),
		),
	})
	.meta({ id: "OutgoingPending" });

export const removeMeSchema = z
	.object({
		id: idSchema,
		confirmBalanceChange: z.boolean().optional().meta({
			description:
				"Remove yourself even though your share is already paid, so the payer then owes you. Without it that is a conflict.",
		}),
	})
	.meta({ id: "RemoveMeFromSharedExpense" });

export const removedMeSchema = z
	.object({ id: idSchema, ...undoField })
	.meta({ id: "RemovedMe" });

/** Reading one split expense, and the verification calls the Needs you list leads to. */
export const sharedExpenseExtrasContract = {
	get: v1
		.route({
			method: "GET",
			path: "/shared-expenses/{id}",
			operationId: "getSharedExpense",
			tags: TAG,
			summary: "One split expense with its shares and what you may do",
			description:
				"For people on it and members of its project. Its history is GET /shared-expenses/{id}/history.",
		})
		.meta({ scope: "read" })
		.input(z.object({ id: idSchema }))
		.output(sharedExpenseDetailSchema),
	outgoing: v1
		.route({
			method: "GET",
			path: "/shared-expenses/outgoing",
			operationId: "listOutgoingPending",
			tags: TAG,
			summary: "Shares others have not answered yet, by person",
			description: "Only expenses you added. Most waiting first.",
		})
		.meta({ scope: "read" })
		.output(outgoingPendingSchema),
	bulkAccept: v1
		.route({
			method: "POST",
			path: "/shared-expenses/accept",
			operationId: "acceptSharedExpenses",
			tags: TAG,
			summary: "Accept your share of many split expenses at once",
			description:
				"All or none. Expenses you already accepted, or that are not yours to answer, are skipped.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.bulk_accepted" })
		.input(bulkAcceptSchema)
		.output(z.object({ accepted: z.int().min(0) })),
	removeMe: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/remove-me",
			operationId: "removeMeFromSharedExpense",
			tags: TAG,
			summary: "Take yourself off a split expense",
			description:
				"Only your own share goes; the others stay. Not for the person who added it (delete it instead), and not once it is settled. When your share is already paid it needs confirmBalanceChange. Answers an undo token for POST /shared-expenses/undo; the preview shows what changes.",
		})
		.meta({ scope: "write:expenses", event: "shared_expense.self_removed" })
		.input(removeMeSchema)
		.output(removedMeSchema),
	previewRemoveMe: previewTwin({
		path: "/shared-expenses/{id}/remove-me",
		of: "POST /shared-expenses/{id}/remove-me",
		operationId: "previewRemoveMeFromSharedExpense",
		tags: TAG,
		scope: "write:expenses",
		input: removeMeSchema,
	}),
};
