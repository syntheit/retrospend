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
/** Styles whose features have landed (02 §8: P2 completes these). */
export const SETUP_STYLES = ["FLEX", "EVERY_DOLLAR", "WEEKLY"] as const;
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
	left: moneySchema,
	/** Σ overspending inside the group ("Over by X" on a Flex row). */
	over: moneySchema,
	need: moneySchema,
	count: z.number().int(),
});

export const envelopeGroupSchema = z.object({
	/** null: envelopes without a group. */
	id: idSchema.nullable(),
	name: z.string().nullable(),
	role: groupRoleSchema.nullable(),
	sortOrder: z.number().int(),
	totals: groupTotalsSchema,
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
		kind: z.enum(["LEFT_TO_SPEND", "TO_ASSIGN", "LEFT_THIS_WEEK"]),
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
	incomplete: z.boolean(),
});

export const monthStateSchema = z.enum(["CLOSED", "OPEN", "NEXT"]);

export const getMonthOutputSchema = z.object({
	book: z.object({
		id: idSchema,
		style: budgetStyleSchema,
		fundingSource: z.enum(["INCOME", "TARGETS"]),
		currency: z.string(),
		startMonth: monthKeySchema,
		weekStartDay: z.number().int(),
		defaultEnvelopeId: idSchema,
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
	incomplete: z.boolean(),
	missingRates: z.array(missingRateSchema),
});

export const fillLineSchema = z.object({
	envelopeId: idSchema,
	amount: moneySchema,
	step: z.enum(["OVERSPENT", "BILL", "GROUP", "MONTHLY", "SAVINGS"]),
});

export const fillFromTargetsOutputSchema = z.object({
	month: monthKeySchema,
	available: moneySchema,
	lines: z.array(fillLineSchema),
	/** What stays Not planned yet after the lines (D-owner-2026-10-22e). */
	rest: moneySchema,
});

export const coverSourceSchema = z.object({
	/** null = To assign. */
	from: idSchema.nullable(),
	kind: z.enum(["POOL", "MONTHLY", "SAVINGS", "BILL", "NONE"]),
	available: moneySchema,
	/** Bills come last with their due date ("Due Nov 5"). */
	dueDate: isoDateSchema.nullable(),
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
	/** Names are message keys the client translates and sends back to setup. */
	groups: z.array(
		z.object({ key: z.string(), nameKey: z.string(), role: groupRoleSchema }),
	),
	envelopes: z.array(
		z.object({
			key: z.string(),
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
	z.object({
		kind: z.literal("SAVINGS"),
		amountMinor: positiveMinor.optional(),
		dueDate: isoDateSchema.optional(),
		monthlyMinor: positiveMinor.optional(),
		currency: z.string().min(3).max(10).optional(),
	}),
]);

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
				}),
			)
			.max(20),
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
				}),
			)
			.min(1)
			.max(200),
	})
	.refine(
		(s) => s.envelopes.filter((e) => e.isDefault).length === 1,
		"exactly one envelope is the default (Everything else)",
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

export const setupResultSchema = z.object({ bookId: idSchema });

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
