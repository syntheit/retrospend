import * as z from "zod";
import { categoryColorSchema } from "../categories";
import { decimalStringSchema, idSchema, timestampSchema } from "../core";

/**
 * Raw rows for the app's local copy (E2EE lane P): one field per column a
 * client can use, the database's own names and enum values, decimals as
 * exact text and instants as ISO 8601. Not the display shapes of
 * GET /expenses: nothing is converted, joined or counted here.
 *
 * Left out on purpose: `userId` (every row is the caller's), the category's
 * `nameIndex` (a keyed hash the server uses for uniqueness) and anything the
 * server keeps to seal text. `importFingerprint` stays: it is the caller's
 * own data (a hash of the import file row) and a copy that imports offline
 * needs it to match a later re-import.
 */

const decimalOrNull = decimalStringSchema.nullable();

export const syncExpenseSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		amount: decimalStringSchema.meta({
			description: "Positive; `direction` carries the sign.",
		}),
		currency: z.string(),
		date: timestampSchema,
		categoryId: idSchema.nullable(),
		amountInUSD: decimalStringSchema,
		exchangeRate: decimalStringSchema,
		pricingSource: z.string(),
		location: z.string().nullable(),
		description: z.string().nullable(),
		status: z.enum(["DRAFT", "FINALIZED"]),
		createdAt: timestampSchema,
		updatedAt: timestampSchema.meta({
			description: "The version a write sends as its base.",
		}),
		isAmortizedParent: z.boolean(),
		isAmortizedChild: z.boolean(),
		parentId: idSchema.nullable(),
		recurringTemplateId: idSchema.nullable(),
		excludeFromAnalytics: z.boolean(),
		direction: z.enum(["OUT", "IN"]),
		entryKind: z.enum([
			"STANDARD",
			"STARTING_BALANCE",
			"ADJUSTMENT",
			"NOT_SPENDING",
		]),
		inType: z.enum(["INCOME", "REFUND"]).nullable(),
		amortizeMode: z.enum(["INSTALLMENTS", "REPORTS_ONLY"]),
		keepInWealth: z.boolean(),
		budgetEnvelopeId: idSchema.nullable(),
		movedInAt: timestampSchema.nullable(),
		planBatchId: idSchema.nullable(),
		rateType: z.string().nullable(),
		homeCurrency: z.string().nullable(),
		homeRate: decimalOrNull.meta({
			description:
				"Units of the home currency per 1 unit of `currency`, booked at save. Set with `homeCurrency` and `homeAmount`, or all three null.",
		}),
		homeAmount: decimalOrNull,
		importFingerprint: z.string().nullable(),
	})
	.meta({ id: "SyncExpense" });

export type SyncExpenseDto = z.infer<typeof syncExpenseSchema>;

export const syncCategorySchema = z
	.object({
		id: idSchema,
		name: z.string(),
		color: categoryColorSchema,
		icon: z.string().nullable(),
		isFixed: z.boolean(),
		excludeByDefault: z.boolean(),
		kind: z.enum(["EXPENSE", "INCOME"]),
	})
	.meta({
		id: "SyncCategory",
		description:
			"Categories have no updatedAt: a changed row comes again by its id.",
	});

export type SyncCategoryDto = z.infer<typeof syncCategorySchema>;

export const syncRecurringTemplateSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		amount: decimalStringSchema,
		currency: z.string(),
		categoryId: idSchema.nullable(),
		direction: z.enum(["OUT", "IN"]),
		amountMode: z.enum(["FIXED", "ASK"]),
		frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
		nextDueDate: timestampSchema,
		anchorDay: z.int().nullable(),
		websiteUrl: z.string().nullable(),
		paymentSource: z.string().nullable(),
		autoPay: z.boolean(),
		isActive: z.boolean(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "SyncRecurringTemplate" });

export type SyncRecurringTemplateDto = z.infer<
	typeof syncRecurringTemplateSchema
>;
