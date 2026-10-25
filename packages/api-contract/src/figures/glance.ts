import * as z from "zod";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { idSchema } from "../core";
import { daySchema } from "../ledger";

/**
 * Home's glance (GET /figures/glance). Every number is a named figure: `id`
 * is the registry id the web tags the number with. A `value` of null means
 * the figure cannot be computed (a missing rate), never zero.
 *
 * The budget part mirrors the envelope budget's verdict and left-to-spend
 * DTOs (src/lib/schemas/envelope.ts). The budget group (G4) owns those
 * shapes; a server test parses the real glance with this schema.
 */
const figureValueSchema = z.object({
	id: z.string(),
	value: moneySchema.nullable(),
});

const spanSchema = z.object({
	from: daySchema,
	to: daySchema,
	/** Calendar days in the period. */
	days: z.int(),
});

const monthKey = z.int().min(190001).max(299912);

const verdictActionSchema = z.enum([
	"FIX_PLAN",
	"COVER",
	"PLAN_BILLS",
	"USE_PLAN",
	"TAKE_BACK",
]);

export const glanceVerdictSchema = z
	.object({
		style: z.enum([
			"LIMITS",
			"FLEX",
			"EVERY_DOLLAR",
			"SAVE_FIRST",
			"FIFTY_THIRTY_TWENTY",
			"WEEKLY",
			"DEBT_PAYOFF",
		]),
		month: monthKey,
		lead: z.object({
			kind: z.enum([
				"LEFT_TO_SPEND",
				"TO_ASSIGN",
				"LEFT_THIS_WEEK",
				"LEFT_IN_LIMITS",
			]),
			figureId: z.string(),
			amount: moneySchema,
		}),
		state: z.enum([
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
		]),
		perDay: moneySchema,
		daysLeft: z.int(),
		over: moneySchema,
		overEnvelopes: z.array(z.object({ id: idSchema, over: moneySchema })),
		billsShort: moneySchema,
		plannedTooMuch: moneySchema,
		resetsOn: daySchema.nullable(),
		action: verdictActionSchema.nullable(),
		notice: z
			.object({
				kind: z.enum(["NOT_PLANNED_YET", "OVERSPENT"]),
				amount: moneySchema,
				action: verdictActionSchema,
			})
			.nullable(),
		poolName: z.enum(["NOT_PLANNED_YET", "TO_ASSIGN"]),
		limits: z.object({ limit: moneySchema, spent: moneySchema }).nullable(),
		incomplete: z.boolean(),
	})
	.meta({ id: "GlanceVerdict" });

export const glanceLeftToSpendSchema = z
	.object({
		left: moneySchema,
		perDay: moneySchema,
		daysLeft: z.int(),
		carry: moneySchema,
		assigned: moneySchema,
		spent: moneySchema,
		plannedTooMuch: moneySchema,
		over: moneySchema,
		billsHeld: moneySchema,
		billsShort: moneySchema,
		billsCount: z.int(),
		savings: moneySchema,
		notPlanned: moneySchema,
		fasterThanPlanned: z.boolean(),
	})
	.meta({ id: "GlanceLeftToSpend" });

export const glanceBudgetSchema = z
	.discriminatedUnion("state", [
		z.object({
			state: z.literal("ready"),
			verdict: glanceVerdictSchema,
			leftToSpend: glanceLeftToSpendSchema,
			/** Signed: negative when more is planned than there is. */
			notPlannedYet: figureValueSchema,
		}),
		z.object({
			state: z.literal("incomplete"),
			missingRates: z.array(currencyCodeSchema),
		}),
	])
	.meta({ id: "GlanceBudget" });

export const glanceSchema = z
	.object({
		home: currencyCodeSchema,
		today: daySchema,
		/** The current spending period (the fiscal month) and the day of it. */
		period: spanSchema.extend({ day: z.int() }),
		lastPeriod: spanSchema,
		spent: figureValueSchema,
		spentLastToDate: figureValueSchema,
		spentLast: figureValueSchema,
		/** Running totals in home minor units, one per day, for the pace line. */
		pace: z.object({
			this: z.array(z.int()).nullable(),
			last: z.array(z.int()).nullable(),
			fasterThanLast: z.boolean().nullable(),
		}),
		owedToYou: figureValueSchema,
		youOwe: figureValueSchema,
		netWorth: figureValueSchema,
		/** Null without a book, with the book paused, or with the envelope budget off. */
		budget: glanceBudgetSchema.nullable(),
		/** Without a budget part only, and only when income exists. */
		moneyIn: figureValueSchema.nullable(),
		/**
		 * Dollar today: the price of USD 1 in the home currency at the default
		 * rate type. Null for a USD or crypto home, where the row does not apply.
		 */
		dollarToday: z
			.object({
				id: z.string(),
				/** Null while the home currency has no rate at all. */
				value: moneySchema.nullable(),
				rateType: z.string().nullable(),
				rateDate: daySchema.nullable(),
				home: currencyCodeSchema,
			})
			.nullable(),
		/** Currencies whose missing rate keeps a number out. */
		missingRates: z.array(currencyCodeSchema),
	})
	.meta({ id: "Glance" });
