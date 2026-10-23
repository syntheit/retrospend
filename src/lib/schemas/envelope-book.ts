/**
 * Contract for the envelope budget's P4 book procedures (budget build plan
 * 02 §5.2, SPEC §4.4, §5.5, §5.6, §5.11): month summaries and their
 * acknowledgement, style switching, pause and resume, Welcome back,
 * reconcile, book periods and Limits. Same conventions as envelope.ts:
 * money is `{ minor, currency }`, months are YYYYMM, dates YYYY-MM-DD, write
 * inputs carry client ids so retries are idempotent.
 */
import { z } from "zod";
import {
	budgetStyleSchema,
	isoDateSchema,
	leftoverRuleSchema,
	minorSchema,
	missingRateSchema,
	moneySchema,
	monthCloseSummarySchema,
	monthKeySchema,
	movementResultSchema,
} from "./envelope";

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");
const fundingSourceSchema = z.enum(["INCOME", "TARGETS"]);

// ── Month summary (SPEC §5.5, §6.6) ─────────────────────────────────────────

/** What a change after the late window did to today's numbers (C16). */
export const monthChangeSchema = z.object({
	/** The earliest closed month the change reached. */
	earliestMonth: monthKeySchema,
	toAssign: moneySchema,
	envelopes: z.array(z.object({ id: idSchema, delta: moneySchema })),
	at: z.string(),
});

export const monthSummaryOutputSchema = z.object({
	summary: monthCloseSummarySchema,
	closedAt: z.date(),
	revision: z.number().int().min(1),
	/** The revision the person acknowledged; null until they do. */
	acknowledgedRevision: z.number().int().nullable(),
	/** Rows added inside the late window ("Includes 3 late expenses"); null for none, never 0. */
	lateEntries: z.number().int().min(1).nullable(),
	/** The latest change after the window, when there is one. */
	change: monthChangeSchema.nullable(),
});

export const acknowledgeMonthInputSchema = z.object({
	month: monthKeySchema,
	/** The revision the person saw; a newer one stays unacknowledged. */
	revision: z.number().int().min(1),
});

export const acknowledgeMonthResultSchema = z.object({
	month: monthKeySchema,
	acknowledgedRevision: z.number().int(),
});

// ── Styles (SPEC §4.4) ──────────────────────────────────────────────────────

/** Styles whose features have landed (02 §8: P2 and P4). */
export const SWITCH_STYLES = [
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"WEEKLY",
] as const;
export const switchStyleSchema = z.enum(SWITCH_STYLES);

export const setStyleInputSchema = z.object({
	/** Client id of the Adjustment a switch to an income style writes. */
	id: clientIdSchema,
	style: switchStyleSchema,
	/** Leaving Limits: "How much do you have right now?" in the book currency. */
	haveNowMinor: nonNegativeMinor.optional(),
	/** STYLE_DEFAULT: Monthly envelopes on the old style's leftover default take the new one (listed first). */
	leftovers: z.enum(["KEEP", "STYLE_DEFAULT"]).default("STYLE_DEFAULT"),
});

const ruleRowSchema = z.object({
	envelopeId: idSchema,
	rule: leftoverRuleSchema,
});

export const stylePreviousSchema = z.object({
	style: budgetStyleSchema,
	fundingSource: fundingSourceSchema,
	planFundFrom: monthKeySchema.nullable(),
	startingMoneyConfirmedAt: z.date().nullable(),
	rules: z.array(ruleRowSchema),
});

export const setStyleResultSchema = z.object({
	bookId: idSchema,
	style: budgetStyleSchema,
	fundingSource: fundingSourceSchema,
	/** Limits: the first month a plan-funding batch opens (next month). */
	fundedFrom: monthKeySchema.nullable(),
	ruleChanges: z.array(
		z.object({
			envelopeId: idSchema,
			from: leftoverRuleSchema,
			to: leftoverRuleSchema,
		}),
	),
	/** Leaving Limits: the Adjustment that makes To assign what you have minus what envelopes hold. */
	adjustment: z.object({ id: idSchema, amount: moneySchema }).nullable(),
	/** What the undo (revertStyle) puts back. */
	previous: stylePreviousSchema,
});

export const revertStyleInputSchema = z.object({
	previous: stylePreviousSchema,
	adjustmentId: idSchema.nullable(),
});

export const revertStyleResultSchema = z.object({
	bookId: idSchema,
	style: budgetStyleSchema,
	fundingSource: fundingSourceSchema,
});

export const pauseResultSchema = z.object({
	paused: z.boolean(),
	/** Resume: Welcome back waits from here (SPEC §4.4). */
	welcomeBackFrom: z.date().nullable(),
});

// ── Welcome back (SPEC §5.5, S26) and reconcile (SPEC §5.11) ────────────────

export const accountLineSchema = z.object({
	id: idSchema,
	name: z.string(),
	/** What it holds in its own currency (a card balance counts negative). */
	worth: moneySchema,
	/** In the book currency at today's rate; null when that rate is missing. */
	value: moneySchema.nullable(),
});

export const bankSideSchema = z.object({
	/** ToAssign + Σ Left + Assigned(next): what the budget holds. */
	holds: moneySchema,
	/** Σ accounts that are part of the budget, in the book currency. */
	accounts: z.array(accountLineSchema),
	bank: moneySchema,
	/** bank - holds: what an Adjustment would record. */
	difference: moneySchema,
	/** Money people owe you: in neither side, shown apart. */
	held: moneySchema,
	reconciledAt: z.date().nullable(),
	incomplete: z.boolean(),
	missingRates: z.array(missingRateSchema),
});

export const welcomeBackSchema = z.object({
	pending: z.boolean(),
	since: isoDateSchema.nullable(),
	/** Closes waiting to be read, oldest first. */
	months: z.array(
		z.object({
			month: monthKeySchema,
			revision: z.number().int(),
			acknowledged: z.boolean(),
		}),
	),
	/** "Set what I have now": the bank side as a prefill. */
	bank: bankSideSchema,
});

export const welcomeBackInputSchema = z.discriminatedUnion("choice", [
	z.object({ choice: z.literal("CATCH_UP") }),
	z.object({
		choice: z.literal("SET_HAVE_NOW"),
		/** Client id of the Adjustment. */
		id: clientIdSchema,
		amountMinor: nonNegativeMinor,
	}),
	z.object({ choice: z.literal("START_FRESH"), batchId: clientIdSchema }),
]);

export const adjustmentSchema = z.object({
	/** Null when nothing needed recording (it already matched). */
	expenseId: idSchema.nullable(),
	/** Signed: positive raises To assign. */
	amount: moneySchema,
});

export const welcomeBackResultSchema = z.object({
	choice: z.enum(["CATCH_UP", "SET_HAVE_NOW", "START_FRESH"]),
	adjustment: adjustmentSchema.nullable(),
	movements: movementResultSchema.nullable(),
	/** Catch up: the summaries to open, oldest first. */
	months: z.array(monthKeySchema),
});

export const reconcileInputSchema = z.object({
	/** Client id of the Adjustment row. */
	id: clientIdSchema,
	/** The difference to record; 0 records that it matched. */
	amountMinor: nonNegativeMinor,
	direction: z.enum(["IN", "OUT"]),
});

export const removeAdjustmentInputSchema = z.object({ expenseId: idSchema });

// ── Book periods (SPEC §5.1, C20) ───────────────────────────────────────────

export const setBookPeriodInputSchema = z
	.object({
		startDay: z.number().int().min(1).max(28).optional(),
		rateType: z.string().min(1).max(32).optional(),
	})
	.refine(
		(p) => p.startDay !== undefined || p.rateType !== undefined,
		"change the start day or the rate type",
	);

export const bookPeriodResultSchema = z.object({
	/** The period row written; null when the change put back what was in force. */
	periodId: idSchema.nullable(),
	/** The first month the change applies to: never one that started already. */
	fromMonth: monthKeySchema,
	/** "Starts with the month that begins Dec 25." */
	startsOn: isoDateSchema,
	startDay: z.number().int(),
	rateType: z.string(),
	/** What was in force from that month before: the undo sets it back. */
	previous: z.object({ startDay: z.number().int(), rateType: z.string() }),
	/** This month's dates after the change (its end moves with the next start). */
	currentMonth: z.object({
		key: monthKeySchema,
		from: isoDateSchema,
		to: isoDateSchema,
	}),
});

// ── Limits (SPEC §5.6, A2) ──────────────────────────────────────────────────

export const setLimitInputSchema = z.object({
	/** Client id of the PLAN_FUND delta. */
	id: clientIdSchema,
	envelopeId: idSchema,
	/** The new limit in minor units of `currency`. */
	amountMinor: nonNegativeMinor,
	/** The currency the person typed (default: the book's); kept and converted each month (D25). */
	currency: z.string().min(3).max(10).optional(),
	/** "Only this month" or "From now on". */
	scope: z.enum(["THIS_MONTH", "FROM_NOW_ON"]),
});

/** Every stored target column of an envelope, as they were: what an undo writes back exactly. */
export const targetSnapshotSchema = z.object({
	kind: z.enum(["MONTHLY", "BILL", "SAVINGS", "NONE"]),
	targetAmount: z.string().nullable(),
	targetCurrency: z.string().nullable(),
	targetMode: z.enum(["REFILL", "SET_ASIDE"]),
	targetCadence: z.enum(["MONTH", "WEEK"]),
	targetMonthlyAmount: z.string().nullable(),
	targetDueDate: isoDateSchema.nullable(),
	targetRepeat: z.string().nullable(),
	targetTemplateId: idSchema.nullable(),
	targetLiabilityId: idSchema.nullable(),
	targetStartMonth: monthKeySchema.nullable(),
});

export const setLimitResultSchema = movementResultSchema.extend({
	envelopeId: idSchema,
	/** As typed, in its currency. */
	limit: moneySchema,
	/** The same limit in the book currency at today's rate: what this month is funded to. */
	limitInBook: moneySchema,
	/** What this month's plan funding gave the envelope before (the undo funds it back to this). */
	previous: moneySchema,
	scope: z.enum(["THIS_MONTH", "FROM_NOW_ON"]),
	/** The stored target before the change; the undo (revertLimit) writes it back. */
	previousTarget: targetSnapshotSchema,
});

export const revertLimitInputSchema = z.object({
	/** Client id of the PLAN_FUND delta back. */
	id: clientIdSchema,
	envelopeId: idSchema,
	previousTarget: targetSnapshotSchema,
	/** What the month was funded to before (setLimit's `previous`). */
	fundedMinor: nonNegativeMinor,
});

export const revertLimitResultSchema = movementResultSchema.extend({
	envelopeId: idSchema,
});

export type MonthSummaryOutput = z.infer<typeof monthSummaryOutputSchema>;
export type AcknowledgeMonthInput = z.infer<typeof acknowledgeMonthInputSchema>;
export type SetStyleInput = z.infer<typeof setStyleInputSchema>;
export type SetStyleResult = z.infer<typeof setStyleResultSchema>;
export type StylePrevious = z.infer<typeof stylePreviousSchema>;
export type RevertStyleInput = z.infer<typeof revertStyleInputSchema>;
export type RevertStyleResult = z.infer<typeof revertStyleResultSchema>;
export type PauseResult = z.infer<typeof pauseResultSchema>;
export type BankSide = z.infer<typeof bankSideSchema>;
export type WelcomeBack = z.infer<typeof welcomeBackSchema>;
export type WelcomeBackInput = z.infer<typeof welcomeBackInputSchema>;
export type WelcomeBackResult = z.infer<typeof welcomeBackResultSchema>;
export type Adjustment = z.infer<typeof adjustmentSchema>;
export type ReconcileInput = z.infer<typeof reconcileInputSchema>;
export type RemoveAdjustmentInput = z.infer<typeof removeAdjustmentInputSchema>;
export type SetBookPeriodInput = z.infer<typeof setBookPeriodInputSchema>;
export type BookPeriodResult = z.infer<typeof bookPeriodResultSchema>;
export type SetLimitInput = z.infer<typeof setLimitInputSchema>;
export type SetLimitResult = z.infer<typeof setLimitResultSchema>;
export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;
export type RevertLimitInput = z.infer<typeof revertLimitInputSchema>;
export type RevertLimitResult = z.infer<typeof revertLimitResultSchema>;
