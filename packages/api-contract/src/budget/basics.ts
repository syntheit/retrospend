/** Primitives and enums of the budget (months are YYYYMM numbers, money in is integer minor units of the book currency). Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { amountTextSchema } from "../ledger";

export const minorSchema = z
	.number()
	.int()
	.refine(Number.isSafeInteger, "must be a safe integer");

export const monthKeySchema = z
	.number()
	.int()
	.min(190001)
	.max(299912)
	.refine((m) => m % 100 >= 1 && m % 100 <= 12, "not a YYYYMM month");

export const isoDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "not a YYYY-MM-DD date");

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

export const clientIdSchema = z.string().uuid();
/**
 * Money that goes in is decimal text in the currency's major units (the same
 * as every other v1 write); the server turns it into minor units with the
 * currency's own decimals and refuses a digit beyond them. Which currency is
 * the object's `currency` when it has one, else the budget's.
 */
export const positiveAmount = amountTextSchema;

export const nonNegativeAmount = z
	.string()
	.regex(
		/^\d{1,11}(\.\d{1,8})?$/,
		"Use digits and at most 8 decimals, like 50.25",
	)
	.meta({
		id: "NonNegativeAmountText",
		description:
			"An amount of zero or more as decimal text, in the currency's major units.",
		examples: ["0", "50.25"],
	});

export const signedAmount = z
	.string()
	.regex(
		/^-?\d{1,11}(\.\d{1,8})?$/,
		"Use digits and at most 8 decimals, like -50.25",
	)
	.meta({
		id: "SignedAmountText",
		description:
			"An amount as decimal text in the currency's major units; below zero takes money back or is owed.",
		examples: ["-50.25", "120"],
	});
