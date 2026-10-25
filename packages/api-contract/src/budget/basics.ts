/** Primitives and enums of the budget (months are YYYYMM numbers, money in is integer minor units of the book currency). Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";

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
export const positiveMinor = minorSchema.refine(
	(v) => v > 0,
	"must be above 0",
);
export const nonNegativeMinor = minorSchema.refine(
	(v) => v >= 0,
	"must be 0 or more",
);
