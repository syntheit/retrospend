import * as z from "zod";
import { v1 } from "../common/meta";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idParamsSchema, idSchema, timestampSchema } from "../core";
import { activityRowSchema } from "../expenses/schemas";
import { frequencySchema, planRestSchema, planResultSchema } from "../income";
import {
	accountChangeSchema,
	amountTextSchema,
	daySchema,
	previewTwin,
	rateTextSchema,
	undoField,
	undoInputSchema,
} from "../ledger";

const TAG = ["Recurring"];

export const recurringItemSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		category: z.object({
			id: idSchema.nullable(),
			name: z.string().nullable(),
			icon: z.string().nullable(),
			tone: z.int(),
		}),
		frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]),
		/** The next occurrence, as a day in the caller's time zone. */
		next: daySchema,
		/** The stored due instant. A confirm sends it back as its guard. */
		dueAt: timestampSchema,
		/** The day after this one is confirmed. */
		nextAfter: daySchema,
		/** The earliest day a confirm can say it was paid: the previous due day. */
		paidOnFrom: daySchema,
		state: z.enum(["upcoming", "due", "overdue"]),
		paused: z.boolean(),
		autoPay: z.boolean(),
		/** `in` is recurring income. */
		direction: z.enum(["out", "in"]),
		/** `ask`: the amount varies, so a confirm needs the real amount. */
		amountMode: z.enum(["fixed", "ask"]),
		amount: moneySchema,
		/** In the home currency when foreign; null: no rate yet. Absent: same currency. */
		home: moneySchema.nullish(),
		websiteUrl: z.string().nullable(),
		paymentSource: z.string().nullable(),
		updatedAt: timestampSchema,
	})
	.meta({ id: "RecurringItem" });

export type RecurringItemDto = z.infer<typeof recurringItemSchema>;

const costSchema = z.object({
	month: moneySchema,
	quarter: moneySchema,
	year: moneySchema,
	/** Currencies without a rate whose templates are left out of the cost. */
	missingRate: z.array(z.string()),
});

export const recurringSummarySchema = z
	.object({
		today: daySchema,
		homeCurrency: currencyCodeSchema,
		/** What active templates cost per period, at today's rates. */
		out: costSchema,
		/** Null when no active template brings money in. */
		in: costSchema.nullable(),
		/** This month's entries logged from a template. */
		logged: z.array(activityRowSchema),
	})
	.meta({ id: "RecurringSummary" });

const templateFields = {
	name: userText("recurring.name", 191),
	amount: amountTextSchema,
	currency: currencyCodeSchema,
	categoryId: idSchema.optional(),
	frequency: frequencySchema,
	nextDueDate: daySchema,
	anchorDay: z.number().int().min(1).max(31).optional().meta({
		description:
			"Day of month a monthly, quarterly or yearly schedule keeps (1 to 31). nextDueDate must be that day, or the last day of a shorter month. Default is the day of nextDueDate.",
	}),
	direction: z.enum(["out", "in"]).optional().meta({
		description: "`in` is recurring income. Default out.",
	}),
	amountMode: z.enum(["fixed", "ask"]).optional().meta({
		description:
			"`ask`: the amount varies and never posts on its own; a confirm names it. Default fixed.",
	}),
	websiteUrl: userText("recurring.websiteUrl", 512).optional(),
	paymentSource: userText("recurring.paymentSource", 191).optional(),
	autoPay: z.boolean().optional().meta({ description: "Default true." }),
};

export const createRecurringSchema = z
	.object(templateFields)
	.meta({ id: "CreateRecurring" });

export const updateRecurringSchema = z
	.object({
		id: idSchema,
		name: templateFields.name,
		amount: templateFields.amount,
		currency: templateFields.currency,
		categoryId: idSchema.nullable(),
		frequency: templateFields.frequency,
		nextDueDate: templateFields.nextDueDate,
		amountMode: templateFields.amountMode,
		websiteUrl: userText("recurring.websiteUrl", 512).nullable(),
		paymentSource: userText("recurring.paymentSource", 191).nullable(),
		autoPay: z.boolean(),
		paused: z.boolean(),
	})
	.partial({
		name: true,
		amount: true,
		currency: true,
		categoryId: true,
		frequency: true,
		nextDueDate: true,
		amountMode: true,
		websiteUrl: true,
		paymentSource: true,
		autoPay: true,
		paused: true,
	})
	.meta({ id: "UpdateRecurring" });

export const confirmRecurringSchema = z
	.object({
		id: idSchema,
		dueAt: timestampSchema.optional().meta({
			description:
				"The item's dueAt. A repeat of the same confirm is refused instead of booking the next period.",
		}),
		amount: amountTextSchema.optional().meta({
			description:
				"The real amount, required when amountMode is ask and refused when it is fixed.",
		}),
		paidOn: daySchema.optional().meta({
			description:
				"The day it was really paid or received, never in the future and not before the item's paidOnFrom. The entry and its rate use this day; the template still moves on from the due date. Default: the due date.",
		}),
		rateType: rateTypeSchema.nullish().meta({
			description: "Recurring income in a foreign currency only.",
		}),
		customRate: rateTextSchema.nullish().meta({
			description: "Recurring income in a foreign currency only.",
		}),
		into: idSchema.nullish().meta({
			description: "Recurring income only: the account it lands in.",
		}),
		keep: z.boolean().nullish().meta({
			description: "Recurring income only: keep it in Wealth.",
		}),
		usePlan: z.boolean().optional().meta({
			description: "Recurring income only: assign it by the envelope plan.",
		}),
		planRest: planRestSchema.optional(),
	})
	.meta({ id: "ConfirmRecurring" });

export const recurringConfirmResultSchema = z
	.object({
		/** The entry the confirm booked; read it at GET /expenses/{id}. */
		expenseId: idSchema,
		templateId: idSchema,
		direction: z.enum(["out", "in"]),
		/** The new due instant of the template. */
		nextDueAt: timestampSchema.nullable(),
		/** Recurring income only. */
		booked: moneySchema.nullable(),
		account: accountChangeSchema.nullable(),
		kept: z.boolean().nullable(),
		plan: planResultSchema.nullable(),
	})
	.meta({ id: "RecurringConfirm" });

export const skipRecurringSchema = z
	.object({
		id: idSchema,
		dueAt: timestampSchema.meta({
			description:
				"The item's dueAt. A repeat of the same skip is refused instead of skipping the next period.",
		}),
	})
	.meta({ id: "SkipRecurring" });

export const recurringSkipResultSchema = z
	.object({
		templateId: idSchema,
		/** The due instant that was skipped. */
		skippedAt: timestampSchema,
		/** The new due instant of the template. */
		nextDueAt: timestampSchema,
	})
	.meta({ id: "RecurringSkip" });

export const recurringSkipWriteSchema = z
	.object({ skipped: recurringSkipResultSchema, ...undoField })
	.meta({ id: "RecurringSkipWrite" });

export const recurringDeleteWriteSchema = z
	.object({ ok: z.literal(true), ...undoField })
	.meta({ id: "RecurringDeleteWrite" });

export const recurringSkipUndoResultSchema = z
	.object({ templateId: idSchema, dueAt: timestampSchema })
	.meta({ id: "RecurringSkipUndo" });

export const recurringConfirmWriteSchema = z
	.object({ confirmed: recurringConfirmResultSchema, ...undoField })
	.meta({ id: "RecurringConfirmWrite" });

export const recurringUndoResultSchema = z
	.object({
		expenseId: idSchema,
		templateId: idSchema,
		/**
		 * Always null. A confirm books at the rate of its due date and, for a
		 * varying amount, needs the amount typed again, so putting it back is a
		 * new confirm (POST /recurring/{id}/confirm), previewed like any other.
		 */
		redo: undoTokenSchema.nullable(),
	})
	.meta({ id: "RecurringUndo" });

/**
 * Recurring expenses and income (`direction`). Create, update and delete
 * change the template only. A confirm books the entry for the due date and
 * moves the template on, so it is a money write: it has a preview twin and
 * an undo token for POST /recurring/undo.
 */
export const recurringContract = {
	list: v1
		.route({
			method: "GET",
			path: "/recurring",
			operationId: "listRecurring",
			tags: TAG,
			summary: "Recurring templates, next due first",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(recurringItemSchema)),
	summary: v1
		.route({
			method: "GET",
			path: "/recurring/summary",
			operationId: "getRecurringSummary",
			tags: TAG,
			summary: "What recurring costs per month, quarter and year",
			description:
				"A template whose currency has no rate is named in missingRate and left out, never counted as zero.",
		})
		.meta({ scope: "read" })
		.output(recurringSummarySchema),
	get: v1
		.route({
			method: "GET",
			path: "/recurring/{id}",
			operationId: "getRecurring",
			tags: TAG,
			summary: "One recurring template",
		})
		.meta({ scope: "read" })
		.input(idParamsSchema)
		.output(recurringItemSchema),
	create: v1
		.route({
			method: "POST",
			path: "/recurring",
			operationId: "createRecurring",
			tags: TAG,
			summary: "Add a recurring expense or income",
			successStatus: 201,
		})
		.meta({ scope: "write:expenses", event: "recurring.created" })
		.input(createRecurringSchema)
		.output(recurringItemSchema),
	previewCreate: previewTwin({
		path: "/recurring",
		of: "POST /recurring",
		operationId: "previewCreateRecurring",
		tags: TAG,
		scope: "write:expenses",
		input: createRecurringSchema,
	}),
	update: v1
		.route({
			method: "PATCH",
			path: "/recurring/{id}",
			operationId: "updateRecurring",
			tags: TAG,
			summary: "Change a template, or pause it with paused",
		})
		.meta({ scope: "write:expenses", event: "recurring.updated" })
		.input(updateRecurringSchema)
		.output(recurringItemSchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/recurring/{id}",
			operationId: "deleteRecurring",
			tags: TAG,
			summary: "Delete a template",
			description: "Entries it already booked stay.",
		})
		.meta({ scope: "write:expenses", event: "recurring.deleted" })
		.input(idParamsSchema)
		.output(recurringDeleteWriteSchema),
	previewDelete: previewTwin({
		path: "/recurring/{id}",
		twinPath: "/recurring/{id}/delete/preview",
		of: "DELETE /recurring/{id}",
		operationId: "previewDeleteRecurring",
		tags: TAG,
		scope: "write:expenses",
		input: idParamsSchema,
	}),
	undoDelete: v1
		.route({
			method: "POST",
			path: "/recurring/delete/undo",
			operationId: "undoDeleteRecurring",
			tags: TAG,
			summary: "Put a deleted template back from its undo token",
			description:
				"Restores the template with its schedule and auto-pay. Entries it logged were never removed, but they are not linked to it again.",
		})
		.meta({ scope: "write:expenses", event: "recurring.undone" })
		.input(undoInputSchema)
		.output(recurringItemSchema),
	previewUndoDelete: previewTwin({
		path: "/recurring/delete/undo",
		of: "POST /recurring/delete/undo",
		operationId: "previewUndoDeleteRecurring",
		tags: TAG,
		scope: "write:expenses",
		input: undoInputSchema,
	}),
	confirm: v1
		.route({
			method: "POST",
			path: "/recurring/{id}/confirm",
			operationId: "confirmRecurring",
			tags: TAG,
			summary: "Confirm a due template, with the amount when it varies",
			description:
				"Books the entry for the due date and moves the template to its next date. Recurring income also lands in an account and can use the plan.",
		})
		.meta({ scope: "write:money", event: "recurring.confirmed" })
		.input(confirmRecurringSchema)
		.output(recurringConfirmWriteSchema),
	previewConfirm: previewTwin({
		path: "/recurring/{id}/confirm",
		of: "POST /recurring/{id}/confirm",
		operationId: "previewConfirmRecurring",
		tags: TAG,
		scope: "write:money",
		input: confirmRecurringSchema,
	}),
	skip: v1
		.route({
			method: "POST",
			path: "/recurring/{id}/skip",
			operationId: "skipRecurring",
			tags: TAG,
			summary: "Skip a due item this time",
			description:
				"Moves the template to its next date and books nothing. Fixed or varying, expense or income.",
		})
		.meta({ scope: "write:money", event: "recurring.skipped" })
		.input(skipRecurringSchema)
		.output(recurringSkipWriteSchema),
	previewSkip: previewTwin({
		path: "/recurring/{id}/skip",
		of: "POST /recurring/{id}/skip",
		operationId: "previewSkipRecurring",
		tags: TAG,
		scope: "write:money",
		input: skipRecurringSchema,
	}),
	undoSkip: v1
		.route({
			method: "POST",
			path: "/recurring/skip/undo",
			operationId: "undoSkipRecurring",
			tags: TAG,
			summary: "Revert a skip from its undo token",
			description:
				"Puts the template back on the skipped date. Only the newest change of a template can be undone.",
		})
		.meta({ scope: "write:money", event: "recurring.undone" })
		.input(undoInputSchema)
		.output(recurringSkipUndoResultSchema),
	previewUndoSkip: previewTwin({
		path: "/recurring/skip/undo",
		of: "POST /recurring/skip/undo",
		operationId: "previewUndoSkipRecurring",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
	undo: v1
		.route({
			method: "POST",
			path: "/recurring/undo",
			operationId: "undoRecurringConfirm",
			tags: TAG,
			summary: "Revert a confirm from its undo token",
			description:
				"Removes the booked entry and puts the template back on its due date. Only the newest confirm of a template can be undone; an older one is a conflict until the later ones are undone.",
		})
		.meta({ scope: "write:money", event: "recurring.undone" })
		.input(undoInputSchema)
		.output(recurringUndoResultSchema),
	previewUndo: previewTwin({
		path: "/recurring/undo",
		of: "POST /recurring/undo",
		operationId: "previewUndoRecurringConfirm",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
