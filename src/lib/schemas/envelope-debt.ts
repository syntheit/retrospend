/**
 * Contract for debts in the budget (build plan 02 §8 P6, SPEC §5.11):
 * liability terms (APR, minimum, due day), the payoff plan and its
 * projection, and Pay down a debt (principal leaves the budget from the
 * paying envelope, interest is spending). Money is the Money DTO in integer
 * minor units; APR is a decimal string ("24.5" = 24.5% a year).
 */
import {
	debtPaymentResultSchema,
	debtTermsResultSchema,
	debtTermsSchema,
	interestEstimateSchema,
	payoffDebtSchema,
	payoffPlanResultSchema,
	payoffPlanSchema,
	payoffProjectionSchema,
	payoffStrategySchema,
} from "@retrospend/api-contract/budget";
import { z } from "zod";
import { isoDateSchema, minorSchema } from "./envelope";

export {
	debtPaymentResultSchema,
	debtTermsResultSchema,
	debtTermsSchema,
	interestEstimateSchema,
	payoffDebtSchema,
	payoffPlanResultSchema,
	payoffPlanSchema,
	payoffProjectionSchema,
	payoffStrategySchema,
};

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const positiveMinor = minorSchema.refine((v) => v > 0, "must be above 0");
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");
const aprSchema = z
	.string()
	.regex(/^\d{1,3}(\.\d{1,6})?$/, "a yearly rate like 24.5");

// ── Liability terms ─────────────────────────────────────────────────────────

export const setDebtTermsInputSchema = z.object({
	assetAccountId: idSchema,
	/** Null clears it. */
	aprPercent: aprSchema.nullable(),
	/** In the liability's own currency; null clears it. */
	minimumMinor: nonNegativeMinor.nullable(),
	/** Day of the month the minimum is due (1 to 31; a short month uses its last day). */
	dueDay: z.number().int().min(1).max(31).nullable(),
});

// ── Payoff plan (SPEC §5.11, D72) ───────────────────────────────────────────

export const savePayoffPlanInputSchema = z.object({
	strategy: payoffStrategySchema,
	/** Each month on top of the minimums, in the book currency. */
	extraMonthlyMinor: nonNegativeMinor,
	/** CUSTOM: liability ids in payoff order. */
	customOrder: z.array(idSchema).max(50).default([]),
	/** "Extra debt payment": gets a Set aside target equal to the extra. */
	envelopeId: idSchema.nullable(),
});

export const payoffProjectInputSchema = z
	.object({
		/** Try another plan without saving it (the slider); default: the saved plan. */
		strategy: payoffStrategySchema.optional(),
		extraMonthlyMinor: nonNegativeMinor.optional(),
		customOrder: z.array(idSchema).max(50).optional(),
	})
	.default({});

// ── Pay down a debt (SPEC §5.11, S14, B11) ──────────────────────────────────

export const recordDebtPaymentInputSchema = z.object({
	/** Client id: the transfer's id, so a retry writes once. */
	id: clientIdSchema,
	liabilityId: idSchema,
	/** Where the money comes from; null = Not tracked (in the book currency). */
	fromAccountId: idSchema.nullable(),
	/** The envelope it leaves; null = To assign. */
	envelopeId: idSchema.nullable(),
	/**
	 * Toward the balance. For a credit card, only the old-debt part: new card
	 * spending already came out of your envelopes (D3).
	 */
	principalMinor: positiveMinor,
	/** "Interest in this payment", recorded as spending (Fees). */
	interestMinor: nonNegativeMinor,
	/** Where the interest counts; default the Fees category. */
	interestCategoryId: idSchema.nullable().optional(),
	date: isoDateSchema.optional(),
});

/** Interest a payment likely includes: this month's balance x APR / 12. */
export const interestEstimateInputSchema = z.object({ liabilityId: idSchema });

export type SetDebtTermsInput = z.infer<typeof setDebtTermsInputSchema>;
export type DebtTerms = z.infer<typeof debtTermsSchema>;
export type DebtTermsResult = z.infer<typeof debtTermsResultSchema>;
export type SavePayoffPlanInput = z.infer<typeof savePayoffPlanInputSchema>;
export type PayoffPlanDto = z.infer<typeof payoffPlanSchema>;
export type PayoffPlanResult = z.infer<typeof payoffPlanResultSchema>;
export type PayoffProjectInput = z.infer<typeof payoffProjectInputSchema>;
export type PayoffProjection = z.infer<typeof payoffProjectionSchema>;
export type RecordDebtPaymentInput = z.infer<
	typeof recordDebtPaymentInputSchema
>;
export type DebtPaymentResult = z.infer<typeof debtPaymentResultSchema>;
export type InterestEstimate = z.infer<typeof interestEstimateSchema>;
