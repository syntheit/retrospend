/** Inputs of recurring.create and recurring.update. */
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";

/**
 * A template's id. Templates made on a phone carry a client-made uuid, those
 * made here a cuid, so the id is any non-empty string and every query filters
 * by userId (the same rule as the API v1 id).
 */
export const templateIdSchema = z.string().min(1).max(64);

/** The template's updatedAt the caller last read; as an instant, so it compares as time. */
export const templateStampInput = z.iso
	.datetime({ offset: true })
	.transform((stamp) => new Date(stamp))
	.optional();

export const createRecurringInput = z.object({
	name: userText("recurring.name", 191),
	amount: z.number().positive(),
	currency: z.string().length(3).default("USD"),
	categoryId: z.cuid().optional(),
	frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
	nextDueDate: z.date(),
	websiteUrl: userText("recurring.websiteUrl", 512).pipe(z.url()).optional(),
	paymentSource: userText("recurring.paymentSource", 191).optional(),
	autoPay: z.boolean().default(true),
});

export const updateRecurringInput = z.object({
	id: templateIdSchema,
	expectedUpdatedAt: templateStampInput,
	name: userText("recurring.name", 191).optional(),
	amount: z.number().positive().optional(),
	currency: z.string().length(3).optional(),
	categoryId: z.cuid().nullable().optional(),
	frequency: z
		.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
		.optional(),
	nextDueDate: z.date().optional(),
	websiteUrl: userText("recurring.websiteUrl", 512)
		.pipe(z.url())
		.nullable()
		.optional(),
	paymentSource: userText("recurring.paymentSource", 191).nullable().optional(),
	autoPay: z.boolean().optional(),
	isActive: z.boolean().optional(),
});
