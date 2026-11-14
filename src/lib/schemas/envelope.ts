/**
 * Contract for the envelope budget (budget build plan 02 §5.2, P2): the zod
 * inputs and outputs of every `envelope.*` procedure. tRPC procedures declare
 * them with `.input()` and `.output()`, and /api/v1 builds on the same
 * schemas (z.toJSONSchema), so web, mobile and the API share one shape.
 *
 * Money is always the Money DTO `{ minor, currency }` (IMPLEMENTATION §2.2):
 * integer minor units, computed on the server (R9), formatted by the one
 * formatter. Months are YYYYMM numbers, dates YYYY-MM-DD calendar dates.
 */
import {
	billRepeatSchema,
	budgetStyleSchema,
	coverOverviewSchema,
	coverSourceSchema,
	envelopeGroupSchema,
	envelopeKindSchema,
	envelopeRowSchema,
	envelopeStatusSchema,
	envelopeTargetSchema,
	fillFromTargetsOutputSchema,
	fillLineSchema,
	forgiveResultSchema,
	getMonthOutputSchema,
	groupRoleSchema,
	groupTargetKindSchema,
	groupTargetSchema,
	groupTotalsSchema,
	isoDateSchema,
	leftoverRuleSchema,
	leftThisWeekSchema,
	leftToSpendSchema,
	minorSchema,
	missingRateSchema,
	monthCloseEnvelopeSchema,
	monthCloseSummarySchema,
	monthKeySchema,
	monthStateSchema,
	movementKindSchema,
	owedLineSchema,
	owedPersonSchema,
	owedSchema,
	owedSummarySchema,
	participantRefSchema,
	payFrequencySchema,
	poolNameSchema,
	projectBudgetRoutingSchema,
	projectRoutingResultSchema,
	restChoiceSchema,
	restOptionSchema,
	ruleMatchSchema,
	SETUP_STYLES,
	setupPaySchema,
	setupStyleSchema,
	shareCategoryResultSchema,
	shareCategorySourceSchema,
	targetCadenceSchema,
	targetModeSchema,
	toAssignSchema,
	verdictActionSchema,
	verdictSchema,
	verdictStateSchema,
} from "@retrospend/api-contract/budget";
import { moneySchema, userText } from "@retrospend/api-contract/common";
import { z } from "zod";

export {
	billRepeatSchema,
	budgetStyleSchema,
	coverOverviewSchema,
	coverSourceSchema,
	envelopeGroupSchema,
	envelopeKindSchema,
	envelopeRowSchema,
	envelopeStatusSchema,
	envelopeTargetSchema,
	fillFromTargetsOutputSchema,
	fillLineSchema,
	forgiveResultSchema,
	getMonthOutputSchema,
	groupRoleSchema,
	groupTargetKindSchema,
	groupTargetSchema,
	groupTotalsSchema,
	isoDateSchema,
	leftoverRuleSchema,
	leftThisWeekSchema,
	leftToSpendSchema,
	minorSchema,
	missingRateSchema,
	moneySchema,
	monthCloseEnvelopeSchema,
	monthCloseSummarySchema,
	monthKeySchema,
	monthStateSchema,
	movementKindSchema,
	owedLineSchema,
	owedPersonSchema,
	owedSchema,
	owedSummarySchema,
	participantRefSchema,
	payFrequencySchema,
	poolNameSchema,
	projectBudgetRoutingSchema,
	projectRoutingResultSchema,
	restChoiceSchema,
	restOptionSchema,
	ruleMatchSchema,
	SETUP_STYLES,
	setupPaySchema,
	setupStyleSchema,
	shareCategoryResultSchema,
	shareCategorySourceSchema,
	targetCadenceSchema,
	targetModeSchema,
	toAssignSchema,
	verdictActionSchema,
	verdictSchema,
	verdictStateSchema,
};

const idSchema = z.string().min(1).max(64);
/** Client-made ids (movements, batches) make retries idempotent. */
const clientIdSchema = z.string().uuid();

/**
 * The styles that fund the envelopes' amounts from the money you start with,
 * in the same write as the book. A plan with no amounts funds nothing.
 */
export const AMOUNT_SETUP_STYLES: ReadonlySet<(typeof SETUP_STYLES)[number]> =
	new Set(["FLEX", "WEEKLY", "EVERY_DOLLAR", "DEBT_PAYOFF"]);

// ── Outputs ─────────────────────────────────────────────────────────────────

// ── Month close (P4, SPEC §5.5) ─────────────────────────────────────────────

// ── Splits and money owed (P3, SPEC §5.8) ───────────────────────────────────

export const movementSchema = z.object({
	id: idSchema,
	month: monthKeySchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amount: moneySchema,
	kind: movementKindSchema,
	batchId: idSchema.nullable(),
	revertsId: idSchema.nullable(),
	createdAt: z.date(),
	/** Not yet undone, not an undo itself, and in an open month. */
	canUndo: z.boolean(),
});

export const historyOutputSchema = z.object({
	items: z.array(movementSchema),
	nextCursor: idSchema.nullable(),
});

export const movementResultSchema = z.object({
	movements: z.array(movementSchema.omit({ canUndo: true })),
	/** Every envelope the write moved, with its Left before and after (RC-5: every line listed). */
	envelopes: z.array(
		z.object({ id: idSchema, before: moneySchema, after: moneySchema }),
	),
	toAssign: z.object({ before: moneySchema, after: moneySchema }),
});

export const setupPresetOutputSchema = z.object({
	style: setupStyleSchema,
	currency: z.string(),
	/** Limits: spending rows without a rate were left out of the proposed limits (R14). */
	missingRates: z.array(missingRateSchema).default([]),
	/** Names are message keys the client translates and sends back to setup. */
	groups: z.array(
		z.object({
			key: z.string(),
			nameKey: z.string(),
			role: groupRoleSchema,
			target: z.lazy(() => groupTargetInputSchema).optional(),
		}),
	),
	/** Save first: "20% of money in to Savings", "The rest to Spending" (the percentage is asked). */
	rules: z.array(z.lazy(() => presetRuleSchema)).optional(),
	envelopes: z.array(
		z.object({
			key: z.string(),
			/** Save first asks whether this envelope's leftovers sweep to the savings goal. */
			sweepToKey: z.string().optional(),
			nameKey: z.string().nullable(),
			/** A recurring template's or category's own name, when the envelope follows one. */
			name: z.string().nullable(),
			groupKey: z.string(),
			kind: envelopeKindSchema,
			isDefault: z.boolean(),
			categoryIds: z.array(idSchema),
			templateId: idSchema.nullable(),
			target: z.lazy(() => targetInputSchema).nullable(),
		}),
	),
});

// ── Inputs ──────────────────────────────────────────────────────────────────

const positiveMinor = minorSchema.refine((v) => v > 0, "must be above 0");
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");

/** Amounts are minor units of `currency` (default: the book currency, D25). */
export const targetInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("MONTHLY"),
		amountMinor: nonNegativeMinor,
		mode: targetModeSchema.default("REFILL"),
		cadence: targetCadenceSchema.default("MONTH"),
		currency: z.string().min(3).max(10).optional(),
	}),
	z.object({
		kind: z.literal("BILL"),
		amountMinor: positiveMinor,
		dueDate: isoDateSchema,
		repeat: billRepeatSchema.nullable(),
		currency: z.string().min(3).max(10).optional(),
	}),
	z.object({
		kind: z.literal("BILL_TEMPLATE"),
		templateId: idSchema,
	}),
	/** A bill that follows a liability's minimum and due day (SPEC §5.4, §5.11). */
	z.object({
		kind: z.literal("BILL_LIABILITY"),
		liabilityId: idSchema,
	}),
	z.object({
		kind: z.literal("SAVINGS"),
		amountMinor: positiveMinor.optional(),
		dueDate: isoDateSchema.optional(),
		monthlyMinor: positiveMinor.optional(),
		currency: z.string().min(3).max(10).optional(),
	}),
]);

/** A group's target (SPEC §5.9): a fixed amount or a percent of money in (basis points). */
export const groupTargetInputSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("NONE") }),
	z.object({ kind: z.literal("AMOUNT"), amountMinor: positiveMinor }),
	z.object({
		kind: z.literal("PERCENT_OF_INCOME"),
		basisPoints: z.number().int().min(1).max(10_000),
	}),
]);

export const ruleActionInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("PERCENT"),
		basisPoints: z.number().int().min(1).max(10_000),
	}),
	z.object({ kind: z.literal("AMOUNT"), amountMinor: positiveMinor }),
	z.object({ kind: z.literal("REMAINDER") }),
]);

export const setupRuleSchema = z.object({
	name: userText("incomeRule.name", 64),
	match: ruleMatchSchema,
	action: ruleActionInputSchema,
	envelopeKey: z.string().min(1).max(32),
});

/** A rule a style proposes: the name is a message key the client translates and sends back. */
export const presetRuleSchema = setupRuleSchema
	.omit({ name: true })
	.extend({ nameKey: z.string() });

export const monthInputSchema = z
	.object({ month: monthKeySchema.optional() })
	.default({});

/** Pay off debt: the plan saved in the same write as the book (SPEC §5.11). */
export const setupPayoffSchema = z.object({
	strategy: z.enum(["AVALANCHE", "SNOWBALL"]),
	/** Each month on top of the minimums; becomes the extra envelope's Set aside target. */
	extraMonthlyMinor: nonNegativeMinor,
	/** The envelope of this setup that holds the extra (Monthly). */
	envelopeKey: z.string().min(1).max(32),
});

/** A setup name is trimmed, as before, and never blank. */
const notBlank = (value: string) => value.length > 0;

export const setupInputSchema = z
	.object({
		style: setupStyleSchema,
		currency: z.string().min(3).max(10).optional(),
		weekStartDay: z.number().int().min(0).max(6).optional(),
		/** "How much money do you have right now?" in the book currency (D34). */
		startingMoneyMinor: nonNegativeMinor.optional(),
		groups: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: userText("budgetGroup.name", 64)
						.trim()
						.refine(notBlank, { message: "Name cannot be blank" }),
					role: groupRoleSchema.nullable(),
					target: groupTargetInputSchema.optional(),
				}),
			)
			.max(20),
		/** Income rules the style starts with (Save first), in order. */
		rules: z.array(setupRuleSchema).max(20).optional(),
		/** The pay step: how often you are paid, so the plan can start from the next pay. */
		pay: setupPaySchema.optional(),
		/** Pay off debt only. */
		payoff: setupPayoffSchema.optional(),
		envelopes: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: userText("envelope.name", 64)
						.trim()
						.refine(notBlank, { message: "Name cannot be blank" }),
					groupKey: z.string().min(1).max(32).nullable(),
					kind: envelopeKindSchema,
					isDefault: z.boolean().default(false),
					icon: z.string().max(32).optional(),
					categoryIds: z.array(idSchema).max(200).default([]),
					target: targetInputSchema.optional(),
					/** Leftovers sweep to this envelope at close (SPEC §5.7, asked in Save first). */
					sweepToKey: z.string().min(1).max(32).optional(),
				}),
			)
			.min(1)
			.max(200),
	})
	.refine(
		(s) => s.envelopes.filter((e) => e.isDefault).length === 1,
		"exactly one envelope is the default (Everything else)",
	)
	.refine(
		(s) => s.style !== "LIMITS" || s.startingMoneyMinor === undefined,
		"Limits does not ask for money now (SPEC §4.3)",
	)
	.refine(
		(s) => s.payoff === undefined || s.style === "DEBT_PAYOFF",
		"a payoff plan goes with the Pay off debt style",
	)
	.refine(
		(s) =>
			s.payoff === undefined ||
			s.envelopes.some(
				(e) => e.key === s.payoff?.envelopeKey && e.kind === "MONTHLY",
			),
		"the payoff plan's extra goes to a Monthly envelope of this setup",
	);

export const assignInputSchema = z.object({
	batchId: clientIdSchema,
	month: monthKeySchema,
	/** add: change Assigned by the amount (negative takes back, capped). set: make Assigned this amount. */
	mode: z.enum(["add", "set"]),
	items: z
		.array(
			z.object({
				id: clientIdSchema,
				envelopeId: idSchema,
				amountMinor: minorSchema,
			}),
		)
		.min(1)
		.max(200)
		.refine(
			(items) => new Set(items.map((i) => i.envelopeId)).size === items.length,
			"an envelope appears once per batch",
		)
		.refine(
			(items) => new Set(items.map((i) => i.id)).size === items.length,
			"every item has its own id",
		),
});

export const moveInputSchema = z.object({
	id: clientIdSchema,
	month: monthKeySchema,
	/** null = To assign. */
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amountMinor: positiveMinor,
	kind: z.enum(["MOVE", "COVER", "UNASSIGN"]),
});

export const coverInputSchema = z.object({
	id: clientIdSchema,
	month: monthKeySchema,
	envelopeId: idSchema,
	/** null = from To assign. */
	from: idSchema.nullable(),
	amountMinor: positiveMinor,
});

export const undoInputSchema = z.object({
	/** Batch id for the mirror rows; a retry with the same id is a no-op. */
	id: clientIdSchema,
	target: z.union([
		z.object({ movementId: idSchema }),
		z.object({ batchId: idSchema }),
	]),
});

export const coverSourcesInputSchema = z.object({
	month: monthKeySchema.optional(),
	envelopeId: idSchema,
});

export const historyInputSchema = z.object({
	month: monthKeySchema.optional(),
	envelopeId: idSchema.optional(),
	cursor: idSchema.optional(),
	limit: z.number().int().min(1).max(100).default(50),
});

// ── Previews (R30) ──────────────────────────────────────────────────────────

const figureChangeSchema = z.object({
	id: z.string(),
	currency: z.string(),
	before: moneySchema.nullable(),
	after: moneySchema.nullable(),
	delta: moneySchema,
	figureAfter: z.array(moneySchema).readonly(),
});

const undoTokenSchema = z.union([
	z.object({
		kind: z.literal("revert"),
		mutation: z.string(),
		rows: z.array(z.object({ table: z.string(), id: z.string() })).readonly(),
	}),
	z.object({
		kind: z.literal("mirror"),
		mutation: z.string(),
		movement: z.object({ table: z.string(), id: z.string() }),
	}),
]);

/** What a money write changes, what it checked and leaves alone, and what it could not check. */
export function previewOutputSchema<T extends z.ZodType>(value: T) {
	return z.object({
		value,
		changes: z.array(figureChangeSchema).readonly(),
		unchanged: z
			.array(
				z.object({ id: z.string(), value: z.array(moneySchema).readonly() }),
			)
			.readonly(),
		unavailable: z
			.array(
				z.object({
					id: z.string(),
					before: z.array(moneySchema).readonly().nullable(),
					after: z.array(moneySchema).readonly().nullable(),
				}),
			)
			.readonly(),
	});
}

/** The applied write: the preview's shape plus the undo token. */
export function applyOutputSchema<T extends z.ZodType>(value: T) {
	return previewOutputSchema(value).extend({ undo: undoTokenSchema });
}

export const setupResultSchema = z.object({
	bookId: idSchema,
	/**
	 * What you and each person owe each other as the budget starts, per
	 * person and currency, never netted (owner 2026-10-23): part of the
	 * starting position. Positive: they owe you (counts when it arrives);
	 * negative: you owe them (leaves To assign when you pay).
	 */
	openBalances: z.array(
		z.object({ participant: participantRefSchema, amount: moneySchema }),
	),
	/**
	 * What the plan costs a month against what you start with (the stop when
	 * it costs more than you have). Null for a style that funds itself
	 * (Limits asks for no money now).
	 */
	plan: z
		.object({
			cost: moneySchema,
			available: moneySchema,
			/** max(0, cost - available): what the plan costs beyond what you have. */
			short: moneySchema,
		})
		.nullable(),
	/** The first pay on or after today from the pay step; null when pay varies or was not asked. */
	nextPay: isoDateSchema.nullable(),
	/** Pay off debt: where the saved plan leads, from the same write. Null for any other style. */
	payoff: z
		.object({
			debtFreeMonth: monthKeySchema.nullable(),
			totalInterest: moneySchema,
			/** The minimums fall short of the interest: balances grow at this payment. */
			diverges: z.boolean(),
			/** Debts left out for want of a rate today (R14). */
			incomplete: z.boolean(),
			debts: z.number().int(),
		})
		.nullable(),
	/**
	 * Signed by the server; envelope.undoSetup takes the budget back with it
	 * while it holds nothing but what this write made. Opaque to clients.
	 */
	restore: z.object({
		data: z.string().min(2).max(200_000),
		sig: z.string().regex(/^[0-9a-f]{64}$/),
	}),
});

/** What taking a set-up back deleted: the book, and the starting balance row when setup wrote one. */
export const undoSetupResultSchema = z.object({
	bookId: idSchema,
	expenseId: idSchema.nullable(),
});

export const setShareCategoryInputSchema = z.object({
	transactionId: idSchema,
	/** One of your expense categories; null clears it (Everything else). */
	categoryId: idSchema.nullable(),
	/** USER from the picker; undo passes back what was stored before. */
	source: shareCategorySourceSchema.default("USER"),
});

export const setProjectRoutingInputSchema = z
	.object({
		projectId: idSchema,
		routing: projectBudgetRoutingSchema,
		/** ENVELOPE only: every share of yours in the project lands here. */
		envelopeId: idSchema.nullable().default(null),
	})
	.refine(
		(r) => (r.routing === "ENVELOPE") === (r.envelopeId !== null),
		"pick an envelope exactly when counting the project in one envelope",
	);

export const forgiveInputSchema = z.object({
	/** Client id of the forgive (its payment id): retries are idempotent. */
	id: clientIdSchema,
	participant: participantRefSchema,
	/** The balance's currency. */
	currency: z.string().min(3).max(10),
	/** Minor units of `currency`; at most what they owe you there. */
	amountMinor: positiveMinor,
	/** The envelope it is charged to; null: Everything else. */
	envelopeId: idSchema.nullable(),
});

export const unforgiveInputSchema = z.object({ paymentId: idSchema });

export const carryOverspendInputSchema = z.object({
	/** Client id of the movement: retries are idempotent. */
	id: clientIdSchema,
	/** The envelope that went over last month; it takes the overspend this month instead. */
	envelopeId: idSchema,
	amountMinor: positiveMinor,
});

/** Fix a negative To assign, or start fresh (reset): one batch this month. */
export const batchInputSchema = z.object({ batchId: clientIdSchema });

export const monthSummaryInputSchema = z.object({ month: monthKeySchema });

export const fillFromTargetsInputSchema = z
	.object({
		month: monthKeySchema.optional(),
		/** Plan only this much (an income that just arrived); default: all of To assign. */
		amountMinor: positiveMinor.optional(),
	})
	.default({});

export const setupPresetInputSchema = z.object({ style: setupStyleSchema });

export type Money = z.infer<typeof moneySchema>;
export type EnvelopeTargetDto = z.infer<typeof envelopeTargetSchema>;
export type EnvelopeRowDto = z.infer<typeof envelopeRowSchema>;
export type EnvelopeGroupDto = z.infer<typeof envelopeGroupSchema>;
export type LeftToSpendDto = z.infer<typeof leftToSpendSchema>;
export type VerdictDto = z.infer<typeof verdictSchema>;
export type GetMonthOutput = z.infer<typeof getMonthOutputSchema>;
export type FillFromTargetsOutput = z.infer<typeof fillFromTargetsOutputSchema>;
export type CoverSource = z.infer<typeof coverSourceSchema>;
export type CoverOverview = z.infer<typeof coverOverviewSchema>;
export type MovementDto = z.infer<typeof movementSchema>;
export type HistoryOutput = z.infer<typeof historyOutputSchema>;
export type MovementResult = z.infer<typeof movementResultSchema>;
export type SetupPresetOutput = z.infer<typeof setupPresetOutputSchema>;
export type TargetInput = z.infer<typeof targetInputSchema>;
export type SetupInput = z.infer<typeof setupInputSchema>;
export type AssignInput = z.infer<typeof assignInputSchema>;
export type MoveInput = z.infer<typeof moveInputSchema>;
export type CoverInput = z.infer<typeof coverInputSchema>;
export type UndoInput = z.infer<typeof undoInputSchema>;
export type MonthInput = z.infer<typeof monthInputSchema>;
export type HistoryInput = z.infer<typeof historyInputSchema>;
export type OwedDto = z.infer<typeof owedSchema>;
export type OwedSummaryDto = z.infer<typeof owedSummarySchema>;
export type RestChoice = z.infer<typeof restChoiceSchema>;
export type RestOption = z.infer<typeof restOptionSchema>;
export type SetShareCategoryInput = z.infer<typeof setShareCategoryInputSchema>;
export type ShareCategoryResult = z.infer<typeof shareCategoryResultSchema>;
export type SetProjectRoutingInput = z.infer<
	typeof setProjectRoutingInputSchema
>;
export type ProjectRoutingResult = z.infer<typeof projectRoutingResultSchema>;
export type ForgiveInput = z.infer<typeof forgiveInputSchema>;
export type ForgiveResult = z.infer<typeof forgiveResultSchema>;
export type UnforgiveInput = z.infer<typeof unforgiveInputSchema>;
export type MonthCloseSummary = z.infer<typeof monthCloseSummarySchema>;
export type CarryOverspendInput = z.infer<typeof carryOverspendInputSchema>;
export type BatchInput = z.infer<typeof batchInputSchema>;
export type SetupResult = z.infer<typeof setupResultSchema>;
export type GroupTargetDto = z.infer<typeof groupTargetSchema>;
export type GroupTargetInput = z.infer<typeof groupTargetInputSchema>;
export type RuleMatchInput = z.infer<typeof ruleMatchSchema>;
export type RuleActionInput = z.infer<typeof ruleActionInputSchema>;
export type SetupRule = z.infer<typeof setupRuleSchema>;
