/**
 * Contract for the envelope budget's P4 book procedures (budget build plan
 * 02 §5.2, SPEC §4.4, §5.5, §5.6, §5.11): month summaries and their
 * acknowledgement, style switching, pause and resume, Welcome back,
 * reconcile, book periods and Limits. Same conventions as envelope.ts:
 * money is `{ minor, currency }`, months are YYYYMM, dates YYYY-MM-DD, write
 * inputs carry client ids so retries are idempotent.
 */
import {
	accountLineSchema,
	acknowledgeMonthResultSchema,
	adjustmentSchema,
	bookPeriodResultSchema,
	bankSideSchema as contractBankSideSchema,
	monthSummaryOutputSchema as contractMonthSummaryOutputSchema,
	pauseResultSchema as contractPauseResultSchema,
	revertLimitResultSchema as contractRevertLimitResultSchema,
	setLimitResultSchema as contractSetLimitResultSchema,
	setStyleResultSchema as contractSetStyleResultSchema,
	stylePreviousSchema as contractStylePreviousSchema,
	welcomeBackResultSchema as contractWelcomeBackResultSchema,
	welcomeBackSchema as contractWelcomeBackSchema,
	monthChangeSchema,
	revertStyleResultSchema,
	SWITCH_STYLES,
	switchStyleSchema,
	targetSnapshotSchema,
} from "@retrospend/api-contract/budget";
import { z } from "zod";
import { minorSchema, monthKeySchema, movementResultSchema } from "./envelope";

export {
	accountLineSchema,
	acknowledgeMonthResultSchema,
	adjustmentSchema,
	bookPeriodResultSchema,
	monthChangeSchema,
	revertStyleResultSchema,
	SWITCH_STYLES,
	switchStyleSchema,
	targetSnapshotSchema,
};

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");
const _fundingSourceSchema = z.enum(["INCOME", "TARGETS"]);

// ── Month summary (SPEC §5.5, §6.6) ─────────────────────────────────────────

export const monthSummaryOutputSchema = contractMonthSummaryOutputSchema.extend(
	{ closedAt: z.date() },
);

export const acknowledgeMonthInputSchema = z.object({
	month: monthKeySchema,
	/** The revision the person saw; a newer one stays unacknowledged. */
	revision: z.number().int().min(1),
});

// ── Styles (SPEC §4.4) ──────────────────────────────────────────────────────

export const setStyleInputSchema = z.object({
	/** Client id of the Adjustment a switch to an income style writes. */
	id: clientIdSchema,
	style: switchStyleSchema,
	/** Leaving Limits: "How much do you have right now?" in the book currency. */
	haveNowMinor: nonNegativeMinor.optional(),
	/** STYLE_DEFAULT: Monthly envelopes on the old style's leftover default take the new one (listed first). */
	leftovers: z.enum(["KEEP", "STYLE_DEFAULT"]).default("STYLE_DEFAULT"),
});

export const stylePreviousSchema = contractStylePreviousSchema.extend({
	startingMoneyConfirmedAt: z.date().nullable(),
});

export const setStyleResultSchema = contractSetStyleResultSchema.extend({
	previous: stylePreviousSchema,
});

/** The undo of the last style switch: what it changed is stored server side (budget_book.styleUndo). */
export const revertStyleInputSchema = z.object({});

export const pauseResultSchema = contractPauseResultSchema.extend({
	welcomeBackFrom: z.date().nullable(),
});

// ── Welcome back (SPEC §5.5, S26) and reconcile (SPEC §5.11) ────────────────

export const bankSideSchema = contractBankSideSchema.extend({
	reconciledAt: z.date().nullable(),
});

export const welcomeBackSchema = contractWelcomeBackSchema.extend({
	bank: bankSideSchema,
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

export const welcomeBackResultSchema = contractWelcomeBackResultSchema.extend({
	movements: movementResultSchema.nullable(),
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

export const setLimitResultSchema = contractSetLimitResultSchema.extend({
	movements: movementResultSchema.shape.movements,
});

export const revertLimitInputSchema = z.object({
	/** Client id of the PLAN_FUND delta back. */
	id: clientIdSchema,
	/** The envelope whose last limit edit to undo; what it changed is stored server side (envelope.limitUndo). */
	envelopeId: idSchema,
});

export const revertLimitResultSchema = contractRevertLimitResultSchema.extend({
	movements: movementResultSchema.shape.movements,
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
