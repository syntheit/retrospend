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
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";

export const minorSchema = z
	.number()
	.int()
	.refine(Number.isSafeInteger, "must be a safe integer");

export const moneySchema = z.object({
	minor: minorSchema,
	currency: z.string().min(3).max(10),
});

export const monthKeySchema = z
	.number()
	.int()
	.min(190001)
	.max(299912)
	.refine((m) => m % 100 >= 1 && m % 100 <= 12, "not a YYYYMM month");

export const isoDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "not a YYYY-MM-DD date");

const idSchema = z.string().min(1).max(64);
/** Client-made ids (movements, batches) make retries idempotent. */
const clientIdSchema = z.string().uuid();

export const budgetStyleSchema = z.enum([
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
	"DEBT_PAYOFF",
]);
/** Styles whose features have landed (02 §8: P2 completes these, P4 Limits, P5 Save first and 50/30/20). */
export const SETUP_STYLES = [
	"FLEX",
	"EVERY_DOLLAR",
	"WEEKLY",
	"LIMITS",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"DEBT_PAYOFF",
] as const;
export const setupStyleSchema = z.enum(SETUP_STYLES);

export const envelopeKindSchema = z.enum([
	"MONTHLY",
	"BILL",
	"SAVINGS",
	"NONE",
]);
export const groupRoleSchema = z.enum(["BILLS", "SPENDING", "SAVINGS"]);
export const targetModeSchema = z.enum(["REFILL", "SET_ASIDE"]);
export const targetCadenceSchema = z.enum(["MONTH", "WEEK"]);
export const billRepeatSchema = z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]);
export const movementKindSchema = z.enum([
	"ASSIGN",
	"SET",
	"MOVE",
	"COVER",
	"UNASSIGN",
	"AUTO_FILL",
	"RULE",
	"PLAN_FUND",
	"PLAN_APPLY",
	"CARRY_OVERSPEND",
	"FIX_NEGATIVE",
	"RESET",
	"ARCHIVE",
	"MIGRATION",
	"UNDO",
]);
/** "Not planned yet" in every style except Every dollar (D-owner-2026-10-22f). */
export const poolNameSchema = z.enum(["NOT_PLANNED_YET", "TO_ASSIGN"]);

// ── Outputs ─────────────────────────────────────────────────────────────────

export const missingRateSchema = z.object({
	currency: z.string(),
	rateType: z.string().nullable(),
	date: isoDateSchema,
});

export const envelopeTargetSchema = z.object({
	kind: z.enum(["MONTHLY", "BILL", "SAVINGS"]),
	mode: targetModeSchema.nullable(),
	cadence: targetCadenceSchema.nullable(),
	/** MONTHLY: this month's amount (weekly x weeks). BILL: the cycle. SAVINGS: the goal, in the book currency. */
	amount: moneySchema.nullable(),
	need: moneySchema,
	dueDate: isoDateSchema.nullable(),
	monthsLeft: z.number().int().nullable(),
	perMonth: moneySchema.nullable(),
	progress: moneySchema.nullable(),
	projectedMonth: monthKeySchema.nullable(),
	totalAtDue: moneySchema.nullable(),
	paid: z.boolean(),
	/** A target set in another currency, as set ("about USD 990 today" is the client's label for `amount`). */
	foreign: moneySchema.nullable(),
	/** The foreign target has no rate today: need and amount are 0 and flagged. */
	incomplete: z.boolean(),
	/** BILL: the liability whose minimum it follows (SPEC §5.4); paid through Pay down a debt. */
	liabilityId: idSchema.nullable().optional(),
	/** A bill that follows a liability: payments to it cover this cycle's minimum. */
	debtPaid: z.boolean().optional(),
});

export const leftThisWeekSchema = z.object({
	amount: moneySchema,
	perDay: moneySchema,
	weekIndex: z.number().int(),
	weeks: z.number().int(),
	daysLeftInWeek: z.number().int(),
	resetsOn: isoDateSchema.nullable(),
});

export const envelopeStatusSchema = z.enum([
	"OVERSPENT",
	"UNDERFUNDED",
	"FUNDED",
	"NO_TARGET",
]);

export const envelopeRowSchema = z.object({
	id: idSchema,
	name: z.string(),
	icon: z.string().nullable(),
	color: z.string().nullable(),
	kind: envelopeKindSchema,
	groupId: idSchema.nullable(),
	isDefault: z.boolean(),
	sortOrder: z.number().int(),
	categoryIds: z.array(idSchema),
	carryIn: moneySchema,
	assigned: moneySchema,
	activity: moneySchema,
	/**
	 * What the envelope spent this month: spending and your shares minus
	 * refunds, never Wealth moves (D24). A positive amount in the book
	 * currency from the stored values, never revalued at today's rate.
	 */
	spent: moneySchema,
	/** Spent of what it holds (carried in plus assigned), hundredths of a percent, 0 to 10000; null for a savings goal. */
	spentBasis: z.number().int().min(0).max(10_000).nullable(),
	left: moneySchema,
	/** Shares still waiting for your OK, inside Activity (D20). */
	pending: moneySchema,
	status: envelopeStatusSchema,
	target: envelopeTargetSchema.nullable(),
	leftThisWeek: leftThisWeekSchema.nullable(),
});

export const groupTotalsSchema = z.object({
	carryIn: moneySchema,
	assigned: moneySchema,
	activity: moneySchema,
	/** Σ spent of its envelopes (see `spent` on a row). */
	spent: moneySchema,
	left: moneySchema,
	/** Σ overspending inside the group ("Over by X" on a Flex row). */
	over: moneySchema,
	/**
	 * Limits books only (null elsewhere): Σ Left of the group's envelopes that
	 * have a limit, the same rows as the hero's "Left in your limits". An
	 * envelope with no limit only tracks what was spent and is not in it.
	 */
	limitLeft: moneySchema.nullable(),
	need: moneySchema,
	count: z.number().int(),
});

export const groupTargetKindSchema = z.enum([
	"NONE",
	"AMOUNT",
	"PERCENT_OF_INCOME",
]);

/**
 * A group's target this month (SPEC §5.9): "Wants · planned 30% · spent
 * 31%". Percentages are basis points (3000 = 30%), the base is this month's
 * budget income or, before any arrives, typical income ("of your usual
 * income"). Null base: no income yet and no closed month to judge by.
 */
export const groupTargetSchema = z.object({
	kind: z.enum(["AMOUNT", "PERCENT_OF_INCOME"]),
	/** T_g in the book currency; null for a % target without a base yet. */
	amount: moneySchema.nullable(),
	basisPoints: z.number().int().nullable(),
	base: moneySchema.nullable(),
	baseSource: z.enum(["THIS_MONTH", "TYPICAL"]).nullable(),
	plannedBp: z.number().int().nullable(),
	spentBp: z.number().int().nullable(),
	/** max(0, T_g - Σ assigned in the group). */
	need: moneySchema,
	mainEnvelopeId: idSchema.nullable(),
	/** What goes to the main envelope after the children's own needs. */
	mainExtra: moneySchema,
	/** Guidance only: "Envelope targets need X more than Wants' 30%". */
	childrenOverBy: moneySchema,
	/** A rate is missing in the base: the percentages are not shown as fact. */
	incomplete: z.boolean(),
});

export const envelopeGroupSchema = z.object({
	/** null: envelopes without a group. */
	id: idSchema.nullable(),
	name: z.string().nullable(),
	role: groupRoleSchema.nullable(),
	sortOrder: z.number().int(),
	totals: groupTotalsSchema,
	/** Null without a target, or for a closed month. */
	target: groupTargetSchema.nullable().optional(),
	envelopes: z.array(envelopeRowSchema),
});

export const toAssignSchema = z.object({
	amount: moneySchema,
	poolName: poolNameSchema,
	terms: z.object({
		moneyIn: moneySchema,
		assigned: moneySchema,
		assignedAhead: moneySchema,
		overspendTaken: moneySchema,
		returned: moneySchema,
		splitsNet: moneySchema,
	}),
});

export const leftToSpendSchema = z.object({
	left: moneySchema,
	perDay: moneySchema,
	daysLeft: z.number().int(),
	carry: moneySchema,
	assigned: moneySchema,
	spent: moneySchema,
	plannedTooMuch: moneySchema,
	over: moneySchema,
	billsHeld: moneySchema,
	billsShort: moneySchema,
	billsCount: z.number().int(),
	savings: moneySchema,
	notPlanned: moneySchema,
	fasterThanPlanned: z.boolean(),
});

export const verdictStateSchema = z.enum([
	"PLANNED_TOO_MUCH",
	"OVER_BUDGET",
	"BILLS_SHORT",
	"USED_UP",
	"FASTER_THAN_PLANNED",
	"SOME_OVER",
	"ON_TRACK",
	"ALL_ASSIGNED",
	"NEEDS_JOB",
	"OVER_ASSIGNED",
	"WEEK_LEFT",
	"WEEK_USED",
]);

export const verdictActionSchema = z.enum([
	"FIX_PLAN",
	"COVER",
	"PLAN_BILLS",
	"USE_PLAN",
	"TAKE_BACK",
]);

/** The top of Budget and Home's budget card: one number, one sentence, at most one notice (SYNTHESIS-r6 §4). */
export const verdictSchema = z.object({
	style: budgetStyleSchema,
	month: monthKeySchema,
	lead: z.object({
		kind: z.enum([
			"LEFT_TO_SPEND",
			"TO_ASSIGN",
			"LEFT_THIS_WEEK",
			"LEFT_IN_LIMITS",
		]),
		/** Figure id the UI tags the number with (display audit). */
		figureId: z.string(),
		amount: moneySchema,
	}),
	state: verdictStateSchema,
	perDay: moneySchema,
	daysLeft: z.number().int(),
	over: moneySchema,
	overEnvelopes: z.array(z.object({ id: idSchema, over: moneySchema })),
	billsShort: moneySchema,
	plannedTooMuch: moneySchema,
	resetsOn: isoDateSchema.nullable(),
	action: verdictActionSchema.nullable(),
	notice: z
		.object({
			kind: z.enum(["NOT_PLANNED_YET", "OVERSPENT"]),
			amount: moneySchema,
			action: verdictActionSchema,
		})
		.nullable(),
	poolName: poolNameSchema,
	/** Limits (SPEC §6.1): the month's limits and what they have spent; null in other styles. */
	limits: z.object({ limit: moneySchema, spent: moneySchema }).nullable(),
	incomplete: z.boolean(),
});

export const monthStateSchema = z.enum(["CLOSED", "OPEN", "NEXT"]);

// ── Month close (P4, SPEC §5.5) ─────────────────────────────────────────────

export const leftoverRuleSchema = z.enum(["CARRY", "RETURN", "SWEEP"]);

/** One envelope at the end of a closed month, in book-currency minor units. */
export const monthCloseEnvelopeSchema = z.object({
	id: idSchema,
	carryIn: minorSchema,
	assigned: minorSchema,
	activity: minorSchema,
	left: minorSchema,
	/** The rule it closed under (B7: a later change applies from the next close). */
	rule: leftoverRuleSchema,
	sweepToId: idSchema.nullable(),
	carried: minorSchema,
	returned: minorSchema,
	swept: minorSchema,
	/** max(0, -Left): taken from next month's To assign (D4). */
	overspent: minorSchema,
});

/** What `month_close.summary` stores (book-currency minor units). */
export const monthCloseSummarySchema = z.object({
	month: monthKeySchema,
	currency: z.string(),
	moneyIn: minorSchema,
	assigned: minorSchema,
	overspent: minorSchema,
	returned: minorSchema,
	/** Held for others at the end of the month, per person and currency (D9). */
	held: z.array(
		z.object({
			counterparty: z.string(),
			currency: z.string(),
			native: minorSchema,
			held: minorSchema,
		}),
	),
	envelopes: z.array(monthCloseEnvelopeSchema),
	/**
	 * Category to envelope routing the month closed with: moving a category
	 * later routes only the open months there (B7). Absent on closes made
	 * before routing was kept.
	 */
	links: z.record(z.string(), z.string()).optional(),
});

// ── Splits and money owed (P3, SPEC §5.8) ───────────────────────────────────

export const participantRefSchema = z.object({
	type: z.enum(["user", "guest", "shadow"]),
	id: z.string().min(1).max(191),
});

export const owedLineSchema = z.object({
	/** In the balance's own currency. Positive: they owe you; negative: you owe them. */
	amount: moneySchema,
	/** What the budget holds for it: the book value of what they owe you. */
	held: moneySchema,
	/** When the oldest part still owed started (first in, first out). */
	oldestOpen: isoDateSchema.nullable(),
	ageDays: z.number().int().nullable(),
});

export const owedPersonSchema = z.object({
	participant: participantRefSchema,
	name: z.string().nullable(),
	lines: z.array(owedLineSchema),
	held: moneySchema,
	/** Payments to you waiting for your OK (D8): shown, not counted. */
	pending: moneySchema,
	lastPaidOn: isoDateSchema.nullable(),
	ageDays: z.number().int().nullable(),
	/** Owed 60 days or more with no payment in 60 days (C15): Remind or Forgive. */
	aging: z.boolean(),
});

export const owedSchema = z.object({
	held: moneySchema,
	pending: moneySchema,
	people: z.array(owedPersonSchema),
	/** Projects you count "Not in budget" (D31): listed, never counted. */
	notInBudget: z.array(z.object({ projectId: idSchema, name: z.string() })),
	incomplete: z.boolean(),
});

/** The Owed line on the Budget page. */
export const owedSummarySchema = z.object({
	held: moneySchema,
	pending: moneySchema,
	/** People who owe you money the budget holds. */
	people: z.number().int().min(0),
	aging: z.number().int().min(0),
});

export const shareCategorySourceSchema = z.enum([
	"USER",
	"NAME_MATCH",
	"PROJECT",
	"PERSON",
	"TITLE",
]);
export const projectBudgetRoutingSchema = z.enum([
	"CATEGORY",
	"ENVELOPE",
	"NOT_IN_BUDGET",
]);

export const getMonthOutputSchema = z.object({
	book: z.object({
		id: idSchema,
		style: budgetStyleSchema,
		fundingSource: z.enum(["INCOME", "TARGETS"]),
		currency: z.string(),
		startMonth: monthKeySchema,
		weekStartDay: z.number().int(),
		defaultEnvelopeId: idSchema,
		/** Switched to Just track (SPEC §4.4): Budget shows tracking, no items. */
		paused: z.boolean(),
	}),
	month: z.object({
		key: monthKeySchema,
		from: isoDateSchema,
		to: isoDateSchema,
		state: monthStateSchema,
	}),
	today: isoDateSchema,
	toAssign: toAssignSchema,
	groups: z.array(envelopeGroupSchema),
	leftToSpend: leftToSpendSchema,
	verdict: verdictSchema,
	owed: owedSummarySchema,
	shares: z.object({
		/** Your shares this month with no category: in "Everything else" until you pick (D19). */
		unresolved: z.number().int().min(0),
		/** Your shares this month still waiting for your OK (D20): counted, flagged. */
		pending: moneySchema,
	}),
	incomplete: z.boolean(),
	/** Some foreign rows were valued at the nearest rate there was, not one of their day: the UI shows "≈". */
	approximate: z.boolean(),
	missingRates: z.array(missingRateSchema),
});

export const fillLineSchema = z.object({
	envelopeId: idSchema,
	/** The month it is assigned in: the viewed month, or the next one for "Next month". */
	month: monthKeySchema,
	amount: moneySchema,
	/** PLAN: the saved plan for the month (owner r5 Q1). REST: the rest after the targets, where you chose to put it. */
	step: z.enum([
		"PLAN",
		"OVERSPENT",
		"BILL",
		"GROUP",
		"MONTHLY",
		"SAVINGS",
		"REST",
	]),
});

/** Where the rest goes after Use my plan (D-owner-2026-10-22e): nothing moves unseen. */
export const restChoiceSchema = z.enum(["LEAVE", "SAVE", "NEXT_MONTH"]);

export const restOptionSchema = z.object({
	choice: restChoiceSchema,
	/** SAVE: the savings envelope it goes to. */
	envelopeId: idSchema.nullable(),
	/** NEXT_MONTH: the month it is assigned to. */
	month: monthKeySchema.nullable(),
});

export const fillFromTargetsOutputSchema = z.object({
	month: monthKeySchema,
	available: moneySchema,
	lines: z.array(fillLineSchema),
	/** Each envelope's total over its lines (the plan's and the targets'), in the order of first appearance. */
	totals: z.array(z.object({ envelopeId: idSchema, amount: moneySchema })),
	/** What stays Not planned yet after the lines (D-owner-2026-10-22e). */
	rest: moneySchema,
	/** The choices for the rest; Leave it is the default. */
	restOptions: z.array(restOptionSchema),
});

export const coverSourceSchema = z.object({
	/** null = To assign. */
	from: idSchema.nullable(),
	kind: z.enum(["POOL", "MONTHLY", "SAVINGS", "BILL", "NONE"]),
	available: moneySchema,
	/** Bills come last with their due date ("Due Nov 5"). */
	dueDate: isoDateSchema.nullable(),
});

/** Covering one envelope: how much it is over by, where it can come from, and where the server suggests. */
export const coverOverviewSchema = z.object({
	/** What the envelope is over by (0 when it is not over). */
	need: moneySchema,
	/** The suggested source: never a goal or a bill by default. Null = none fits. */
	suggested: z.object({ from: idSchema.nullable() }).nullable(),
	sources: z.array(coverSourceSchema),
});

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

/** What an income rule matches (SPEC §5.10). TITLE is the one rule that reads titles (E2EE known exception). */
export const ruleMatchSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ANY") }),
	z.object({ kind: z.literal("CATEGORY"), categoryId: idSchema }),
	z.object({ kind: z.literal("TEMPLATE"), templateId: idSchema }),
	z.object({
		kind: z.literal("TITLE"),
		contains: userText("incomeRule.matchTitle", 128),
	}),
	z.object({
		kind: z.literal("CURRENCY"),
		currency: z.string().min(3).max(10),
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
					name: z.string().trim().min(1).max(64),
					role: groupRoleSchema.nullable(),
					target: groupTargetInputSchema.optional(),
				}),
			)
			.max(20),
		/** Income rules the style starts with (Save first), in order. */
		rules: z.array(setupRuleSchema).max(20).optional(),
		envelopes: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: z.string().trim().min(1).max(64),
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
});

export const setShareCategoryInputSchema = z.object({
	transactionId: idSchema,
	/** One of your expense categories; null clears it (Everything else). */
	categoryId: idSchema.nullable(),
	/** USER from the picker; undo passes back what was stored before. */
	source: shareCategorySourceSchema.default("USER"),
});

export const shareCategoryResultSchema = z.object({
	shareId: idSchema,
	categoryId: idSchema.nullable(),
	source: shareCategorySourceSchema.nullable(),
	/** What it was: the undo sets it back. */
	previous: z.object({
		categoryId: idSchema.nullable(),
		source: shareCategorySourceSchema.nullable(),
	}),
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

export const projectRoutingResultSchema = z.object({
	projectId: idSchema,
	/** Your project_participant row: what the undo sets back. */
	participantId: idSchema,
	routing: projectBudgetRoutingSchema,
	envelopeId: idSchema.nullable(),
	previous: z.object({
		routing: projectBudgetRoutingSchema,
		envelopeId: idSchema.nullable(),
	}),
});

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

export const forgiveResultSchema = z.object({
	paymentId: idSchema,
	amount: moneySchema,
	/** What leaves the held money and is charged to the envelope, in the book currency; null without a budget. */
	charged: moneySchema.nullable(),
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
