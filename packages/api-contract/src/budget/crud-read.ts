/** Can I afford it, and shares with no envelope. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { isoDateSchema, monthKeySchema, positiveMinor } from "./basics";

// ── Can I afford it? (SYNTHESIS-r6 §4) ──────────────────────────────────────

export const affordInputSchema = z.object({
	month: monthKeySchema.optional(),
	/** In the book currency. */
	amountMinor: positiveMinor,
	/** Every dollar and Limits answer from one envelope (default: Everything else). */
	envelopeId: idSchema.optional(),
});

export const affordStateSchema = z.enum([
	"FITS",
	"FITS_TIGHT",
	"NO_LIMIT",
	"SHORT_MOVE",
	"SHORT_POOL_COVERS",
	"SHORT_NOTHING_LEFT",
	"WEEK_FITS",
	"WEEK_NEXT_WEEK",
]);

export const affordActionSchema = z.discriminatedUnion("kind", [
	/** Put the shortfall into Spending from Not planned yet. */
	z.object({ kind: z.literal("ADD_TO_SPENDING"), amount: moneySchema }),
	z.object({
		kind: z.literal("MOVE_MONEY"),
		envelopeId: idSchema,
		amount: moneySchema,
	}),
	z.object({ kind: z.literal("PLAN_NEXT_MONTH"), month: monthKeySchema }),
]);

/** The sentence's state and every number in it; the client writes the words. */
export const affordResultSchema = z.object({
	month: monthKeySchema,
	scope: z.enum(["SPENDING", "ENVELOPE", "WEEK"]),
	state: affordStateSchema,
	amount: moneySchema,
	/** The envelope answered from (ENVELOPE scope). */
	envelopeId: idSchema.nullable(),
	/** What the scope holds now: Left to spend, the envelope's Left or Left this week. */
	left: moneySchema,
	/** left - amount; below 0 when it does not fit. */
	after: moneySchema,
	/** How much more it needs; 0 when it fits. */
	short: moneySchema,
	/** About how much a day after paying it. */
	perDay: moneySchema,
	daysLeft: z.number().int(),
	/** About what you usually spend a day (last 3 closed months); null before a first close. */
	usualPerDay: moneySchema.nullable(),
	/** Not planned yet (To assign when it is above 0). */
	notPlanned: moneySchema,
	/** NO_LIMIT: what the envelope spent this month. */
	spent: moneySchema,
	action: affordActionSchema.nullable(),
	incomplete: z.boolean(),
});

// ── Shares with no envelope (SPEC §5.8, §5.14) ──────────────────────────────

export const unroutedSharesInputSchema = z
	.object({ limit: z.number().int().min(1).max(200).default(100) })
	.default({ limit: 100 });

export const unroutedShareSchema = z.object({
	shareId: idSchema,
	/** The split expense it belongs to; the client joins its title. */
	expenseId: idSchema,
	date: isoDateSchema,
	month: monthKeySchema.nullable(),
	/** Your share in the book currency at its date; null when a rate is missing (R14). */
	amount: moneySchema.nullable(),
	projectId: idSchema.nullable(),
	payer: z.object({ type: z.string(), id: idSchema }),
});

export const unroutedSharesOutputSchema = z.object({
	/** Where they land until you pick: Everything else. */
	defaultEnvelopeId: idSchema,
	shares: z.array(unroutedShareSchema),
	total: moneySchema,
	count: z.number().int().min(0),
	incomplete: z.boolean(),
});
