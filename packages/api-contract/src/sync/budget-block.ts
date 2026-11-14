import * as z from "zod";
import { isoDateSchema, minorSchema, monthKeySchema } from "../budget/basics";
import { currencyCodeSchema } from "../common/money";
import { idSchema } from "../core";

/**
 * The budget block of GET /sync/shares?budget=1 (E2EE P13b): what a device
 * needs besides its own rows to read the budget figures as the server does.
 * Every amount is integer minor units of the book currency unless a field
 * says otherwise. Counterparties and every id that is not the caller's own
 * are opaque keys (`p1`, `e1`, ...) numbered by the server for this block
 * alone: the next pull may number them differently, and nothing in here
 * names a person, a project or a title.
 */

const opaqueKeySchema = idSchema.meta({
	description:
		"The caller's own id, or an opaque key (`p1`.. for people, `e1`.. for events, settlements and pending payments) valid in this block only.",
});

const missingRateSchema = z
	.object({
		currency: currencyCodeSchema,
		rateType: z.string().nullable(),
		date: isoDateSchema,
		rowId: opaqueKeySchema.optional(),
	})
	.meta({
		id: "SyncMissingRate",
		description:
			"A rate a figure needed and did not have; the row is left out of every figure, never valued at 1.",
	});

const approximateRowSchema = z
	.object({ rowId: opaqueKeySchema, date: isoDateSchema })
	.meta({
		id: "SyncApproximateRow",
		description:
			"A row valued at the nearest rate, not one dated on or before it.",
	});

const shareEntrySchema = z
	.object({
		id: idSchema.meta({ description: "The caller's participation." }),
		month: monthKeySchema,
		date: isoDateSchema,
		minor: minorSchema.meta({
			description:
				"Negative: the share is spending. Valued in the book currency, as the server froze it.",
		}),
		source: z.literal("SHARE"),
		categoryId: idSchema.nullable().meta({
			description:
				"The caller's own category for the share, resolved on the server.",
		}),
		envelopeId: idSchema.nullable().meta({
			description: "Set only when the share's project routes to one envelope.",
		}),
		pending: z.boolean(),
	})
	.meta({ id: "SyncShareEntry" });

const shareStatusSchema = z.enum([
	"PENDING",
	"ACCEPTED",
	"REJECTED",
	"AUTO_ACCEPTED",
]);
const settlementStatusSchema = z.enum(["PROPOSED", "FINALIZED", "REJECTED"]);

const eventBase = {
	id: opaqueKeySchema,
	counterparty: opaqueKeySchema,
	currency: currencyCodeSchema,
	date: isoDateSchema,
	month: monthKeySchema,
	native: minorSchema.meta({
		description: "Positive, in minor units of `currency`.",
	}),
	notInBudget: z.boolean().optional(),
};

const replayEventSchema = z
	.discriminatedUnion("kind", [
		z.object({
			...eventBase,
			kind: z.literal("FRONT"),
			value: minorSchema,
			shareStatus: shareStatusSchema.optional(),
		}),
		z.object({
			...eventBase,
			kind: z.literal("OWE"),
			status: shareStatusSchema,
		}),
		z.object({ ...eventBase, kind: z.literal("UNFRONT") }),
		z.object({
			...eventBase,
			kind: z.literal("RECV"),
			status: settlementStatusSchema,
			cash: minorSchema,
			isOffset: z.boolean().optional(),
		}),
		z.object({
			...eventBase,
			kind: z.literal("PAY"),
			status: settlementStatusSchema,
			cash: minorSchema,
			isOffset: z.boolean().optional(),
			forgiven: z.boolean().optional(),
		}),
		z.object({
			...eventBase,
			kind: z.literal("FORGIVE"),
			status: settlementStatusSchema,
			envelopeId: idSchema.nullable(),
		}),
	])
	.meta({ id: "SyncReplayEvent" });

const replayEffectSchema = z
	.object({
		eventId: opaqueKeySchema,
		date: isoDateSchema,
		month: monthKeySchema,
		counterparty: opaqueKeySchema,
		currency: currencyCodeSchema,
		term: z.enum(["FRONTED", "RETURNED", "FORGIVEN", "OLD_DEBT_PAID"]),
		minor: minorSchema,
		fx: minorSchema,
		envelopeId: idSchema.nullable().optional(),
	})
	.meta({ id: "SyncReplayEffect" });

const replayBalanceSchema = z
	.object({
		counterparty: opaqueKeySchema,
		currency: currencyCodeSchema,
		native: minorSchema.meta({
			description: "Positive: they owe you. Negative: you owe them.",
		}),
		basis: minorSchema.meta({
			description:
				"Book value of what they owe you; 0 when `native` is not positive.",
		}),
		oldestOpen: isoDateSchema.nullable(),
	})
	.meta({ id: "SyncReplayBalance" });

const ignoredEventSchema = z
	.object({
		eventId: opaqueKeySchema,
		reason: z.enum([
			"NOT_IN_BUDGET",
			"REJECTED",
			"PENDING_NOT_COUNTED",
			"FORGIVE_EXCEEDS_BALANCE",
		]),
		native: minorSchema,
	})
	.meta({ id: "SyncIgnoredEvent" });

const pendingReceiptSchema = z
	.object({
		id: opaqueKeySchema,
		counterparty: opaqueKeySchema,
		currency: currencyCodeSchema,
		native: minorSchema,
		cash: minorSchema.nullable().meta({
			description: "Book value of the cash, or null when its rate is missing.",
		}),
		date: isoDateSchema,
	})
	.meta({ id: "SyncPendingReceipt" });

export const syncSplitBlockSchema = z
	.object({
		shares: z.array(shareEntrySchema),
		effects: z.array(replayEffectSchema),
		balances: z.array(replayBalanceSchema),
		ignored: z.array(ignoredEventSchema),
		events: z.array(replayEventSchema),
		pending: z.array(pendingReceiptSchema),
		unresolved: z.array(idSchema).meta({
			description: "The caller's shares that found no category.",
		}),
		notInBudget: z.array(idSchema).meta({
			description: "Projects the caller counts Not in budget (ids only).",
		}),
		missingRates: z.array(missingRateSchema),
		approximate: z.array(approximateRowSchema),
		checkpointMissingRates: z.array(missingRateSchema).meta({
			description:
				"Rates missing behind the server's checkpoint when the block was made. Those rows stay out of every figure, as they do on the server, even when a rate has arrived since.",
		}),
		checkpointApproximate: z.array(approximateRowSchema),
	})
	.meta({ id: "SyncSplitBlock" });

export type SyncSplitBlockDto = z.infer<typeof syncSplitBlockSchema>;

export const syncFrozenValueSchema = z
	.object({
		key: z.string().max(400).meta({
			description:
				"What the value depends on: the expense id first, then currency, amount, USD value, date and rate type.",
		}),
		minor: minorSchema,
		approximate: z.boolean(),
	})
	.meta({ id: "SyncFrozenValue" });

export const syncBudgetBlockSchema = z
	.object({
		bookId: idSchema,
		valuationKey: z.string().meta({
			description:
				"What the book's valuations depend on (currency, zone, start date, every period). Compare for equality with the key of the book you hold; a mismatch means your rows are stale.",
		}),
		asOf: z.string().meta({
			description:
				"A sync cursor. The block is exact for rows at or below it: use it once every entity cursor you hold has reached it, so pull /sync/shares before the deltas.",
		}),
		frozen: z.array(syncFrozenValueSchema).meta({
			description:
				"Values the server froze for the caller's own expenses (never for shares, which come valued).",
		}),
		splits: syncSplitBlockSchema,
	})
	.meta({ id: "SyncBudgetBlock" });

export type SyncBudgetBlockDto = z.infer<typeof syncBudgetBlockSchema>;

export const syncBudgetUnavailableSchema = z
	.object({ unavailable: z.literal(true) })
	.meta({
		id: "SyncBudgetUnavailable",
		description:
			"The block could not be made for this pull (it failed, or a value was still unfrozen after a retry). Read the budget as unavailable and pull again; the shares and the owed totals in the same response are good.",
	});

export const syncBudgetSchema = z
	.union([syncBudgetBlockSchema, syncBudgetUnavailableSchema])
	.nullable()
	.meta({
		id: "SyncBudget",
		description:
			"null when the caller has no budget to read on a device: Just track, a book others share, or none set up.",
	});

export type SyncBudgetDto = z.infer<typeof syncBudgetSchema>;
