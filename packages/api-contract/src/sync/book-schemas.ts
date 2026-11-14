import * as z from "zod";
import {
	budgetStyleSchema,
	envelopeKindSchema,
	groupRoleSchema,
	movementKindSchema,
	targetCadenceSchema,
	targetModeSchema,
} from "../budget/basics";
import { fundingSourceSchema } from "../budget/book-write";
import { leftoverRuleSchema } from "../budget/close-owed";
import { payoffStrategySchema } from "../budget/debt";
import { payFrequencySchema } from "../budget/inputs";
import { groupTargetKindSchema } from "../budget/month";
import { categoryColorSchema } from "../categories";
import { decimalStringSchema, idSchema, timestampSchema } from "../core";

/**
 * Raw rows of a personal budget book for the app's local copy (E2EE lane P,
 * P14c): the same rules as schemas.ts, one field per column a client can use,
 * the database's own names, decimals as exact text and instants as ISO 8601
 * (a date-only column is the instant at 00:00 UTC). A row belongs to the
 * caller through its book, which is theirs, personal and has no other member:
 * a book that gains a member or stops being personal is shared from that
 * moment, and every row of it comes back as a tombstone.
 *
 * Left out on purpose: the book's creator and every row's `actorUserId` (the
 * caller's own id, or a former member's), the server's undo state
 * (`styleUndo`, `limitUndo`, the payoff plan's `undo`), derived caches (the
 * book's `dirtyFromMonth`, a close's `checkpoint`, which a device rebuilds),
 * the book's `lastOpenedAt` (read bookkeeping; its write still moves
 * `updatedAt`, which a pull carries) and the legacy move's bookkeeping (`legacyMigrationRunId`, `legacyMigratedAt`,
 * `legacyNoticeSeenAt`, `legacyHiddenIds`).
 */

const decimalOrNull = decimalStringSchema.nullable();

/** A JSON column, as stored. */
const jsonSchema = z.unknown();

export const syncBudgetBookSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		isPersonal: z.boolean(),
		currency: z.string(),
		style: budgetStyleSchema,
		fundingSource: fundingSourceSchema,
		pausedAt: timestampSchema.nullable(),
		weekStartDay: z.int(),
		monthStartDay: z.int(),
		timeZone: z.string(),
		timeZoneConfirmed: z.boolean(),
		startDate: timestampSchema,
		startMonth: z.int().meta({ description: "YYYYMM of the first month." }),
		defaultEnvelopeId: idSchema.nullable(),
		startingBalanceExpenseId: idSchema.nullable(),
		startingMoneyConfirmedAt: timestampSchema.nullable(),
		welcomeBackFrom: timestampSchema.nullable(),
		reconciledAt: timestampSchema.nullable(),
		planFundFrom: z.int().nullable(),
		payFrequency: payFrequencySchema.nullable(),
		payAnchor: timestampSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema.meta({
			description:
				"The server's version of the row, the base a write sends. A copy with an older value is out of date.",
		}),
	})
	.meta({ id: "SyncBudgetBook" });

export type SyncBudgetBookDto = z.infer<typeof syncBudgetBookSchema>;

export const syncEnvelopeGroupSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		name: z.string(),
		sortOrder: z.int(),
		role: groupRoleSchema.nullable(),
		targetKind: groupTargetKindSchema,
		targetValue: decimalOrNull.meta({
			description:
				"AMOUNT: in the book's currency; PERCENT_OF_INCOME: the percent.",
		}),
		mainEnvelopeId: idSchema.nullable(),
		archivedAt: timestampSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "SyncEnvelopeGroup" });

export type SyncEnvelopeGroupDto = z.infer<typeof syncEnvelopeGroupSchema>;

export const syncEnvelopeSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		groupId: idSchema.nullable(),
		name: z.string(),
		icon: z.string().nullable(),
		color: categoryColorSchema.nullable(),
		kind: envelopeKindSchema,
		sortOrder: z.int(),
		targetAmount: decimalOrNull,
		targetMode: targetModeSchema,
		targetCadence: targetCadenceSchema,
		targetMonthlyAmount: decimalOrNull,
		targetCurrency: z.string().nullable().meta({
			description: "Null is the book's currency.",
		}),
		targetDueDate: timestampSchema.nullable(),
		targetRepeat: z
			.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"])
			.nullable(),
		targetStartMonth: z.int().nullable(),
		targetTemplateId: idSchema.nullable(),
		targetLiabilityId: idSchema.nullable(),
		leftoverRule: leftoverRuleSchema,
		leftoverSweepToId: idSchema.nullable(),
		wealthAccountId: idSchema.nullable(),
		wealthDedicated: z.boolean(),
		archivedAt: timestampSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "SyncEnvelope" });

export type SyncEnvelopeDto = z.infer<typeof syncEnvelopeSchema>;

export const syncEnvelopeCategorySchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		envelopeId: idSchema,
		categoryId: idSchema,
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncEnvelopeCategory",
		description: "Which envelope a category feeds. Links have no updatedAt.",
	});

export type SyncEnvelopeCategoryDto = z.infer<
	typeof syncEnvelopeCategorySchema
>;

export const syncBudgetMovementSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		month: z.int().meta({ description: "YYYYMM." }),
		fromEnvelopeId: idSchema.nullable().meta({
			description: "Null is Not planned yet (To assign).",
		}),
		toEnvelopeId: idSchema.nullable(),
		amount: decimalStringSchema.meta({
			description: "Positive, in the book's currency.",
		}),
		kind: movementKindSchema,
		batchId: idSchema.nullable(),
		revertsId: idSchema.nullable(),
		sourceExpenseId: idSchema.nullable(),
		ruleId: idSchema.nullable(),
		note: z.string().nullable(),
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncBudgetMovement",
		description: "Movements are appended, never changed.",
	});

export type SyncBudgetMovementDto = z.infer<typeof syncBudgetMovementSchema>;

export const syncBookPeriodSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		fromMonth: z.int().meta({ description: "YYYYMM." }),
		startDay: z.int(),
		rateType: z.string(),
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncBookPeriod",
		description: "The start day and rate type in force from a month on.",
	});

export type SyncBookPeriodDto = z.infer<typeof syncBookPeriodSchema>;

export const syncMonthCloseSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		month: z.int().meta({ description: "YYYYMM." }),
		mode: z.enum(["AUTO", "USER"]),
		closedAt: timestampSchema,
		revision: z.int(),
		summary: jsonSchema,
		acknowledgedAt: timestampSchema.nullable(),
		ackRevision: z.int().nullable(),
		recalc: jsonSchema.nullable(),
		lateEntries: z.int(),
	})
	.meta({
		id: "SyncMonthClose",
		description:
			"One closed month. The engine's checkpoint is left out: a device rebuilds it.",
	});

export type SyncMonthCloseDto = z.infer<typeof syncMonthCloseSchema>;

export const syncIncomeRuleSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		sortOrder: z.int(),
		name: z.string(),
		matchKind: z.enum(["ANY", "CATEGORY", "TEMPLATE", "TITLE", "CURRENCY"]),
		matchValue: z.string().nullable(),
		matchTitle: z.string().nullable(),
		action: z.enum(["PERCENT", "AMOUNT", "REMAINDER"]),
		value: decimalOrNull.meta({
			description:
				"PERCENT: the percent; AMOUNT: in the book's currency; REMAINDER: null.",
		}),
		envelopeId: idSchema,
		active: z.boolean(),
		archivedAt: timestampSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "SyncIncomeRule" });

export type SyncIncomeRuleDto = z.infer<typeof syncIncomeRuleSchema>;

export const syncIncomeRuleRunSchema = z
	.object({
		expenseId: idSchema.meta({
			description:
				"The income row the run is for, and the row's key: a tombstone carries it as its id.",
		}),
		bookId: idSchema,
		batchId: idSchema.nullable(),
		skipped: z.boolean(),
		record: jsonSchema,
		fingerprint: z.string(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({
		id: "SyncIncomeRuleRun",
		description:
			"What the income rules did for one income row, so a rule runs once. It outlives the row.",
	});

export type SyncIncomeRuleRunDto = z.infer<typeof syncIncomeRuleRunSchema>;

export const syncPayoffPlanSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		strategy: payoffStrategySchema,
		extraMonthly: decimalStringSchema.meta({
			description: "In the book's currency.",
		}),
		customOrder: jsonSchema.meta({
			description: "CUSTOM: the account ids in payoff order.",
		}),
		envelopeId: idSchema.nullable(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "SyncPayoffPlan", description: "At most one per book." });

export type SyncPayoffPlanDto = z.infer<typeof syncPayoffPlanSchema>;

export const syncWealthTransferSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		direction: z.enum(["TO_WEALTH", "FROM_WEALTH"]),
		envelopeId: idSchema.nullable().meta({
			description: "Null is Not planned yet (To assign).",
		}),
		transferId: idSchema.nullable(),
		sourceExpenseId: idSchema.nullable(),
		assetAccountId: idSchema.nullable(),
		countOnly: z.boolean(),
		date: timestampSchema,
		amount: decimalStringSchema.meta({
			description: "In the book's currency.",
		}),
		note: z.string().nullable(),
		createdAt: timestampSchema,
	})
	.meta({
		id: "SyncWealthTransfer",
		description:
			"The budget's half of a move between the budget and Wealth. It goes with the transfer or income row that made it.",
	});

export type SyncWealthTransferDto = z.infer<typeof syncWealthTransferSchema>;

export const syncEnvelopeChangeSchema = z
	.object({
		id: idSchema,
		bookId: idSchema,
		kind: z.enum([
			"SET_TARGET",
			"CREATE",
			"UPDATE",
			"MERGE",
			"ARCHIVE",
			"CONFIRM_STARTING_MONEY",
		]),
		envelopeId: idSchema.nullable(),
		previousName: z.string().nullable(),
		before: jsonSchema,
		createdAt: timestampSchema,
		undoneAt: timestampSchema.nullable(),
	})
	.meta({
		id: "SyncEnvelopeChange",
		description:
			"What an envelope edit changed, kept for its undo. `before` holds ids, amounts and flags only.",
	});

export type SyncEnvelopeChangeDto = z.infer<typeof syncEnvelopeChangeSchema>;
