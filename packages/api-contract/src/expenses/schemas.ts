import * as z from "zod";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { amountTextSchema, daySchema, rateTextSchema } from "../ledger";
import { ACTIVITY_KINDS } from "./filter";

/**
 * An entry as GET /expenses/{id} and the writes answer it. `kind` is how the
 * row reads in Activity: spending, money in, a refund or an own transfer.
 */
export const expenseSchema = z
	.object({
		id: idSchema,
		kind: z.enum(["expense", "income", "refund", "transfer"]),
		title: z.string(),
		/** As entered. */
		amount: moneySchema,
		/**
		 * The value in the home currency, booked when the entry was saved so it
		 * never moves with later rates. Null when the entry is already in the
		 * home currency or no booked value exists.
		 */
		home: moneySchema.nullable(),
		/** The rate type the entry was booked at (official, blue, custom...), if any. */
		rateType: rateTypeSchema.nullable(),
		date: daySchema,
		categoryId: idSchema.nullable(),
		location: z.string().nullable(),
		description: z.string().nullable(),
		/** Months the cost is spread over, null when it is not spread. */
		amortizeOver: z.int().min(2).nullable(),
		excludeFromAnalytics: z.boolean(),
		recurringTemplateId: idSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "Expense" });

export type ExpenseDto = z.infer<typeof expenseSchema>;

/**
 * Fields of an expense write. The rate: a `rateType` of the pair, or a typed
 * `customRate`, or neither (the user's default type). The server books the
 * home value from the rate, so no converted amount is ever sent.
 */
export const expenseFieldsSchema = z.object({
	title: userText("expense.title", 500),
	amount: amountTextSchema,
	currency: currencyCodeSchema,
	date: daySchema,
	categoryId: idSchema.optional(),
	rateType: rateTypeSchema.optional(),
	customRate: rateTextSchema.optional().meta({
		description:
			"A typed rate. Wins over rateType. 1 unit of currency is this many units of your home currency.",
	}),
	location: userText("expense.location", 191).optional(),
	description: userText("expense.description", 1000).optional(),
	amortizeOver: z.int().min(2).max(24).optional(),
	excludeFromAnalytics: z.boolean().optional(),
});

export const createExpenseSchema = expenseFieldsSchema
	.extend({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second expense.",
		}),
	})
	.meta({ id: "CreateExpense" });

/** A full replacement: a field left out is cleared. */
export const updateExpenseSchema = z
	.object({ id: idSchema, ...expenseFieldsSchema.shape })
	.meta({ id: "UpdateExpense" });

export const bulkCategorySchema = z
	.object({
		ids: z.array(idSchema).min(1).max(500),
		categoryId: idSchema,
	})
	.meta({ id: "BulkCategorize" });

export const duplicateQuerySchema = z.object({
	title: userText("expense.title", 500),
	amount: amountTextSchema,
	date: daySchema,
});

export const duplicateResultSchema = z
	.object({
		duplicate: z.boolean(),
		/** The existing expense with the same title (any case), amount and day. */
		expenseId: idSchema.nullable(),
	})
	.meta({ id: "DuplicateCheck" });

export const titleSuggestionsQuerySchema = z.object({
	q: userText("expense.search", 100),
});

export const titleSuggestionSchema = z
	.object({
		title: z.string(),
		/** How many expenses and shared expenses carry it. */
		count: z.int(),
		lastCategoryId: idSchema.nullable(),
		lastAmount: moneySchema.nullable(),
	})
	.meta({ id: "TitleSuggestion" });

// ── The Activity list ───────────────────────────────────────────────────────

const categoryRefSchema = z.object({
	id: idSchema.nullable(),
	name: z.string().nullable(),
	icon: z.string().nullable(),
	/** The category-n design token number. */
	tone: z.int(),
});

const personSchema = z.object({
	/** The person key, `<user|shadow|guest>:<id>`. */
	id: z.string(),
	name: z.string(),
	imageUrl: z.string().nullable(),
	isSelf: z.boolean(),
});

/** One line of Activity: a personal entry, your share of a split, or a payment. */
export const activityRowSchema = z
	.object({
		/** Unique across sources: the expense id, `shared:<id>` or `payment:<key>`. */
		id: z.string(),
		source: z.enum(["personal", "shared", "payment"]),
		/** The id the entry's own routes take. */
		entityId: z.string(),
		kind: z.enum(["expense", "income", "refund", "transfer", "payment"]),
		/** Empty for payments. */
		title: z.string(),
		category: categoryRefSchema.nullable(),
		/** As entered (a shared expense: its full amount). */
		amount: moneySchema,
		/** In the home currency when foreign; null: no rate yet. Absent: same currency. */
		home: moneySchema.nullish(),
		/** Your share of a split. */
		share: moneySchema.optional(),
		/** The rate type a foreign row was booked at, when it is not your default. */
		rateType: z.string().optional(),
		/** Home minor units for sorting by amount; null without a rate. */
		sortKey: z.number().nullable(),
		waiting: z.enum(["review", "rejected"]).optional(),
		pending: z.boolean().optional(),
		project: z.object({ id: idSchema, name: z.string() }).nullable(),
		people: z.array(personSchema).optional(),
		payerId: z.string().optional(),
		payerName: z.string().optional(),
		date: daySchema,
		mine: z.boolean(),
		locked: z.boolean(),
		canEdit: z.boolean(),
		payment: z
			.object({
				direction: z.enum(["sent", "received"]),
				counterparty: z.string(),
			})
			.optional(),
	})
	.meta({ id: "ActivityRow" });

export type ActivityRowDto = z.infer<typeof activityRowSchema>;

export const activityKindSchema = z.enum(ACTIVITY_KINDS);

export const activityPageSchema = z
	.object({
		items: z.array(activityRowSchema),
		nextCursor: z.string().nullable(),
		/** Today in the caller's time zone. */
		today: daySchema,
		homeCurrency: currencyCodeSchema,
		/** First page only: rows the filter matches in all pages. */
		count: z.int().nullable(),
		/** First page only: your spending for the filter. Null when spent() cannot express it or a rate is missing. */
		total: z.object({ figure: z.string(), value: moneySchema }).nullable(),
		/** Your spending per day for the days on this page; null like `total`. */
		dayTotals: z.record(z.string(), moneySchema).nullable(),
		/** Currencies whose missing rate kept the totals out. */
		missingRates: z.array(z.string()),
		/** First page with no rows only: whether rows match outside the dates. */
		elsewhere: z.boolean().nullable(),
	})
	.meta({ id: "ActivityPage" });
