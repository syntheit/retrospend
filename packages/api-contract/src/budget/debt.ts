/** Debt terms, payoff plan and Pay down a debt. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import {
	clientIdSchema,
	isoDateSchema,
	minorSchema,
	monthKeySchema,
	nonNegativeMinor,
	positiveMinor,
} from "./basics";

export const aprSchema = z
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

export const debtTermsSchema = z.object({
	assetAccountId: idSchema,
	aprPercent: z.string().nullable(),
	minimum: moneySchema.nullable(),
	dueDay: z.number().int().nullable(),
});

export const debtTermsResultSchema = z.object({
	terms: debtTermsSchema,
	/** What they were, so an undo is the same call with these. */
	previous: debtTermsSchema,
});

// ── Payoff plan (SPEC §5.11, D72) ───────────────────────────────────────────

export const payoffStrategySchema = z.enum(["SNOWBALL", "AVALANCHE", "CUSTOM"]);

export const savePayoffPlanInputSchema = z.object({
	strategy: payoffStrategySchema,
	/** Each month on top of the minimums, in the book currency. */
	extraMonthlyMinor: nonNegativeMinor,
	/** CUSTOM: liability ids in payoff order. */
	customOrder: z.array(idSchema).max(50).default([]),
	/** "Extra debt payment": gets a Set aside target equal to the extra. */
	envelopeId: idSchema.nullable(),
});

export const payoffPlanSchema = z.object({
	strategy: payoffStrategySchema,
	extraMonthly: moneySchema,
	customOrder: z.array(idSchema),
	envelopeId: idSchema.nullable(),
});

export const payoffPlanResultSchema = z.object({
	plan: payoffPlanSchema,
	/** Null when there was no plan; an undo saves `previous` back. */
	previous: payoffPlanSchema.nullable(),
});

export const payoffProjectInputSchema = z
	.object({
		/** Try another plan without saving it (the slider); default: the saved plan. */
		strategy: payoffStrategySchema.optional(),
		extraMonthlyMinor: nonNegativeMinor.optional(),
		customOrder: z.array(idSchema).max(50).optional(),
	})
	.default({});

export const payoffDebtSchema = z.object({
	assetAccountId: idSchema,
	/** Today's balance owed, in its own currency. */
	balance: moneySchema,
	aprPercent: z.string(),
	minimum: moneySchema,
	dueDay: z.number().int().nullable(),
	payoffMonth: monthKeySchema.nullable(),
	interest: moneySchema,
	nextMinimum: moneySchema,
	nextExtra: moneySchema,
});

export const payoffProjectionSchema = z.object({
	plan: payoffPlanSchema,
	/** Null past the 50-year cap (the minimums never cover the interest). */
	debtFreeMonth: monthKeySchema.nullable(),
	months: z.number().int(),
	capped: z.boolean(),
	/** The minimums fall so far short of the interest that balances grow without bound: "never paid off at this payment". The schedule stops early; months and totals are where it stopped. */
	diverges: z.boolean(),
	/** In the book currency at today's rate. */
	totalDebt: moneySchema,
	totalInterest: moneySchema,
	debts: z.array(payoffDebtSchema),
	/** Each month's closing balances, in `debts` order (own currencies). */
	schedule: z.array(
		z.object({ month: monthKeySchema, balances: z.array(minorSchema) }),
	),
	/** Liabilities left out: no rate today to the book currency (R14, never 1). */
	missingRates: z.array(
		z.object({ assetAccountId: idSchema, currency: z.string() }),
	),
	incomplete: z.boolean(),
});

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

export const debtPaymentResultSchema = z.object({
	transferId: idSchema,
	interestExpenseId: idSchema.nullable(),
	principal: moneySchema,
	interest: moneySchema,
	/** The liability's balance before and after, in its own currency. */
	balance: z.object({ before: moneySchema, after: moneySchema }),
	/** The budget side written for the principal. */
	wealthTransferId: idSchema.nullable(),
});

/** Interest a payment likely includes: this month's balance x APR / 12. */
export const interestEstimateInputSchema = z.object({ liabilityId: idSchema });
export const interestEstimateSchema = z.object({
	interest: moneySchema.nullable(),
	/** Prefill on the due day: minimum + the plan's extra share. */
	suggested: moneySchema.nullable(),
});
