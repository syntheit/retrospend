/** Styles, pause, reconcile, book periods and Limits. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema, timestampSchema } from "../core";
import {
	budgetStyleSchema,
	clientIdSchema,
	isoDateSchema,
	minorSchema,
	monthKeySchema,
	nonNegativeMinor,
} from "./basics";
import { leftoverRuleSchema } from "./close-owed";
import { movementResultSchema } from "./read";

export const fundingSourceSchema = z.enum(["INCOME", "TARGETS"]);

// ── Styles (SPEC §4.4) ──────────────────────────────────────────────────────

/** Styles whose features have landed (02 §8: P2, P4 and P5). Between income styles a switch writes nothing beyond the style; the new style's rules and group targets are offered, not written (SPEC §4.4). */
export const SWITCH_STYLES = [
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"WEEKLY",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"DEBT_PAYOFF",
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

export const ruleRowSchema = z.object({
	envelopeId: idSchema,
	rule: leftoverRuleSchema,
});

export const stylePreviousSchema = z.object({
	style: budgetStyleSchema,
	fundingSource: fundingSourceSchema,
	planFundFrom: monthKeySchema.nullable(),
	startingMoneyConfirmedAt: timestampSchema.nullable(),
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

/** The undo of the last style switch: what it changed is stored server side (budget_book.styleUndo). */
export const revertStyleInputSchema = z.object({});

export const revertStyleResultSchema = z.object({
	bookId: idSchema,
	style: budgetStyleSchema,
	fundingSource: fundingSourceSchema,
});

export const pauseResultSchema = z.object({
	paused: z.boolean(),
	/** Resume: Welcome back waits from here (SPEC §4.4). */
	welcomeBackFrom: timestampSchema.nullable(),
});

export const welcomeBackInputSchema = z.discriminatedUnion("choice", [
	z.object({ choice: z.literal("CATCH_UP") }),
	z.object({
		choice: z.literal("SET_HAVE_NOW"),
		/** Client id of the Adjustment. */
		id: clientIdSchema,
		/** Money now in the book currency; below 0 when debts outweigh cash. */
		amountMinor: minorSchema,
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
	/** What the bank says now (signed: a card owing more than the cash is below 0). The server records the difference from what the budget holds, under the book lock; equal records that it matched. */
	bankMinor: minorSchema,
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
	/** The month that straddles the change, longer or shorter, with its dates and length (the preview says so). */
	transition: z.object({
		key: monthKeySchema,
		from: isoDateSchema,
		to: isoDateSchema,
		days: z.number().int(),
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
	/** The envelope whose last limit edit to undo; what it changed is stored server side (envelope.limitUndo). */
	envelopeId: idSchema,
});

export const revertLimitResultSchema = movementResultSchema.extend({
	envelopeId: idSchema,
});
