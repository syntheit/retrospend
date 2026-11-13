import * as z from "zod";
import {
	ACCOUNT_ICON_KINDS,
	accountTypeSchema,
	legSourceSchema,
} from "../accounts/schemas";
import { categoryColorSchema } from "../categories";
import { decimalStringSchema, idSchema, timestampSchema } from "../core";
import { transferKindSchema } from "../transfers";

/**
 * Raw rows for the app's local copy (E2EE lane P): one field per column a
 * client can use, the database's own names and enum values, decimals as
 * exact text and instants as ISO 8601. Not the display shapes of
 * GET /expenses: nothing is converted, joined or counted here.
 *
 * Left out on purpose: `userId` (every row is the caller's), the category's
 * `nameIndex` (a keyed hash the server uses for uniqueness) and anything the
 * server keeps to seal text. The account tables have no server-only column,
 * so each carries every column but `userId`. `importFingerprint` stays: it is the caller's
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

export const syncAccountSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		type: accountTypeSchema,
		currency: z.string(),
		balance: decimalStringSchema.meta({
			description:
				"What the account holds now; the server's trigger moves it with each leg.",
		}),
		exchangeRate: decimalOrNull,
		exchangeRateType: z.string().nullable(),
		isLiquid: z.boolean(),
		interestRate: decimalOrNull,
		minimumPayment: decimalOrNull,
		dueDate: z.int().nullable(),
		inBudget: z.boolean().nullable().meta({
			description: "Null is the default for its kind and currency.",
		}),
		countedUnits: decimalStringSchema,
		closedAt: timestampSchema.nullable(),
		iconKind: z.enum(ACCOUNT_ICON_KINDS).nullable().meta({
			description:
				"Null, with a null `iconValue`, is the default glyph for its type: also what a stored icon the app can no longer draw reads as.",
		}),
		iconValue: z.string().nullable().meta({
			description:
				"As GET /accounts gives it as `icon.value`: a logo slug, an avatar slot, or for IMAGE the picture's URL path like /api/images/accounts/<id>-<ms>.webp.",
		}),
		createdAt: timestampSchema,
		updatedAt: timestampSchema.meta({
			description: "The version a write sends as its base.",
		}),
	})
	.meta({ id: "SyncAccount" });

export type SyncAccountDto = z.infer<typeof syncAccountSchema>;

export const syncAccountSnapshotSchema = z
	.object({
		id: idSchema,
		accountId: idSchema,
		date: timestampSchema,
		balance: decimalStringSchema,
		balanceInUSD: decimalStringSchema,
		currency: z.string().nullable().meta({
			description:
				"The currency of `balance`. Null on a snapshot older than this column: it is the account's own currency (and `type` and `exchangeRateType` then also come from the account, the snapshot's own `exchangeRateType` being ignored).",
		}),
		type: accountTypeSchema.nullable().meta({
			description: "Null: the account's type.",
		}),
		exchangeRateType: z.string().nullable().meta({
			description:
				"The rate type the snapshot was valued at. Meaningful only when `currency` is set; otherwise use the account's.",
		}),
		recordedAt: timestampSchema,
	})
	.meta({
		id: "SyncAccountSnapshot",
		description:
			"Account snapshots have no updatedAt: a changed row, for example when a leg moves the balance, comes again by its id.",
	});

export type SyncAccountSnapshotDto = z.infer<typeof syncAccountSnapshotSchema>;

export const syncAccountLegSchema = z
	.object({
		id: idSchema,
		accountId: idSchema.nullable().meta({
			description: "Null is Not tracked: money outside your accounts.",
		}),
		currency: z.string(),
		amount: decimalStringSchema.meta({
			description: "Signed in what you have; positive is more.",
		}),
		homeAmount: decimalOrNull,
		homeCurrency: z.string().nullable(),
		date: timestampSchema,
		source: legSourceSchema,
		transferId: idSchema.nullable(),
		expenseId: idSchema.nullable(),
		countedUnits: decimalStringSchema,
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncAccountLeg",
		description: "Account legs have no updatedAt.",
	});

export type SyncAccountLegDto = z.infer<typeof syncAccountLegSchema>;

export const syncAccountHistorySchema = z
	.object({
		id: idSchema,
		assetId: idSchema.meta({ description: "The account." }),
		balance: decimalStringSchema,
		recordedAt: timestampSchema,
	})
	.meta({
		id: "SyncAccountHistory",
		description: "Account history rows are written once and never changed.",
	});

export type SyncAccountHistoryDto = z.infer<typeof syncAccountHistorySchema>;

export const syncAccountRateTypeSchema = z
	.object({
		id: idSchema,
		accountId: idSchema,
		from: timestampSchema,
		type: z.string().nullable(),
		previousType: z.string().nullable(),
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncAccountRateType",
		description:
			"The rate type an account is valued at from a day on. Several switches can share a day; createdAt orders them.",
	});

export type SyncAccountRateTypeDto = z.infer<typeof syncAccountRateTypeSchema>;

export const syncTransferSchema = z
	.object({
		id: idSchema,
		kind: transferKindSchema,
		date: timestampSchema,
		fromAccountId: idSchema.nullable(),
		fromAmount: decimalStringSchema,
		fromCurrency: z.string(),
		toAccountId: idSchema.nullable(),
		toAmount: decimalStringSchema,
		toCurrency: z.string(),
		referenceRateType: z.string().nullable(),
		feeExpenseId: idSchema.nullable(),
		countedFromUnits: decimalStringSchema,
		countedToUnits: decimalStringSchema,
		note: z.string().nullable(),
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncTransfer",
		description: "Transfers have no updatedAt. A null account is Not tracked.",
	});

export type SyncTransferDto = z.infer<typeof syncTransferSchema>;
