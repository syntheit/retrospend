/** A month of the budget: envelopes, groups, To assign, Left to spend and the verdict. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import {
	budgetStyleSchema,
	envelopeKindSchema,
	groupRoleSchema,
	isoDateSchema,
	monthKeySchema,
	poolNameSchema,
	targetCadenceSchema,
	targetModeSchema,
} from "./basics";

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
