import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema } from "../core";
import { daySchema } from "../ledger";

/**
 * Shapes of the People and Person pages. Every amount is Money in minor
 * units; a missing rate is null, never 1. Balances are from the viewer's
 * side: positive means they owe you. A person is `{ type, id }`: a Retrospend
 * account, a person you added by name (shadow), or a guest of a project.
 */
export const PARTICIPANT_TYPES = ["user", "guest", "shadow"] as const;

export const participantTypeSchema = z
	.enum(PARTICIPANT_TYPES)
	.meta({ id: "ParticipantType" });

/** A person in a request body. */
export const personRefSchema = z
	.object({ type: participantTypeSchema, id: idSchema })
	.meta({ id: "PersonRef" });

/** A person in a path: `/people/{type}/{id}`. */
export const personParamsSchema = z.object({
	type: participantTypeSchema,
	id: idSchema,
});

const imageUrlSchema = z.string().nullable();

export const personIdentitySchema = z
	.object({
		/** `<type>:<id>`, as the figures and balance bars name a person. */
		key: z.string(),
		type: participantTypeSchema,
		id: idSchema,
		name: z.string(),
		username: z.string().nullable(),
		imageUrl: imageUrlSchema,
		/** A Retrospend account, not a person someone added by name. */
		onRetrospend: z.boolean(),
	})
	.meta({ id: "PersonIdentity" });

/** 1 unit of a currency in another, of a rate type. */
export const rateViewSchema = z
	.object({ type: z.string(), unit: moneySchema, value: moneySchema })
	.meta({ id: "PersonRate" });

export const balancePartSchema = z
	.object({
		amount: moneySchema,
		/** Null when there is no rate: it is left out of the net. */
		home: moneySchema.nullable(),
		rate: rateViewSchema.nullable(),
	})
	.meta({ id: "BalancePart" });

export const PEOPLE_GROUPS = ["owed", "owe", "pending", "settled"] as const;

export const pendingPaymentSchema = z.object({
	/** "in": they paid you and it waits for you. "out": you paid them. */
	direction: z.enum(["in", "out"]),
	amount: moneySchema,
});

export const personSummarySchema = z
	.object({
		person: personIdentitySchema,
		group: z.enum(PEOPLE_GROUPS),
		/** Net in the home currency at the reference rates; null when a currency has no rate. */
		net: moneySchema.nullable(),
		parts: z.array(balancePartSchema),
		pending: pendingPaymentSchema.nullable(),
		/** Splits and payments from this person waiting for you. */
		needsYou: z.int().min(0),
		unseen: z.int().min(0),
		lastShared: z
			.object({
				title: z.string(),
				date: daySchema,
				project: z.string().nullable(),
			})
			.nullable(),
	})
	.meta({ id: "PersonSummary" });

export const barSegmentSchema = z
	.object({
		key: z.string(),
		direction: z.enum(["owed", "owe"]),
		/** Hundredths of a percent of the bar. */
		share: z.int().min(0),
		amount: moneySchema,
	})
	.meta({ id: "BalanceBarSegment" });

/** Something that waits for you on a person: a payment to confirm or a split to review. */
export const needsItemSchema = z
	.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("confirmPayment"),
			/** The payment id. */
			id: idSchema,
			person: personIdentitySchema,
			amount: moneySchema,
			paidOn: daySchema,
		}),
		z.object({
			kind: z.literal("verify"),
			/** The shared expense id. */
			id: idSchema,
			person: personIdentitySchema,
			title: z.string(),
			/** Your share. */
			amount: moneySchema,
			date: daySchema,
		}),
	])
	.meta({ id: "PeopleNeedsItem" });

export const peopleOverviewSchema = z
	.object({
		home: z.string(),
		/** `owed.owedToYou` and `owed.youOwe`: never netted against each other. */
		owedToYou: moneySchema.nullable(),
		youOwe: moneySchema.nullable(),
		/** Currencies someone owes in that have no rate: not in any total. */
		unpriced: z.array(z.string()),
		people: z.array(personSummarySchema),
		segments: z.array(barSegmentSchema),
		needs: z.array(needsItemSchema),
	})
	.meta({ id: "PeopleOverview" });

export const projectRefSchema = z.object({ id: idSchema, name: z.string() });

export const personScopeSchema = z
	.object({
		/** Null is Outside projects. */
		project: projectRefSchema.nullable(),
		/** Open balance per currency; empty when settled. */
		lines: z.array(moneySchema),
		settledSince: daySchema.nullable(),
	})
	.meta({ id: "PersonScope" });

export const personPaymentSchema = z
	.object({
		id: idSchema,
		/** One of its settlement rows. */
		rowId: idSchema.nullable(),
		direction: z.enum(["in", "out"]),
		amount: moneySchema,
		paidOn: daySchema,
		method: z.string().nullable(),
		status: z.enum(["pending", "final"]),
		recordedByMe: z.boolean(),
		/** What it paid per scope; an offset cancels debts and moves no cash. */
		parts: z.array(
			z.object({
				project: projectRefSchema.nullable(),
				amount: moneySchema,
				offset: z.boolean(),
			}),
		),
	})
	.meta({ id: "PersonPayment" });

export const ledgerRowSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		date: daySchema,
		amount: moneySchema,
		category: z
			.object({
				name: z.string(),
				icon: z.string().nullable(),
				/** The category-n design token number. */
				tone: z.int(),
			})
			.nullable(),
		project: projectRefSchema.nullable(),
		paidBy: z.enum(["me", "them", "other"]),
		payerName: z.string(),
		payerId: z.string(),
		people: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				imageUrl: imageUrlSchema,
			}),
		),
		/** What it does between you (positive: they owe you); null when neither of you paid. */
		effect: moneySchema.nullable(),
		/** review: waits for your answer. rejected: you rejected it. settled: locked by a payment. */
		state: z.enum(["ok", "review", "rejected", "settled"]),
		canEdit: z.boolean(),
	})
	.meta({ id: "PersonLedgerRow" });

export const personPageSchema = z
	.object({
		home: z.string(),
		person: personIdentitySchema,
		net: moneySchema.nullable(),
		parts: z.array(balancePartSchema),
		settled: z.object({
			since: daySchema.nullable(),
			pending: z.boolean(),
			nothingShared: z.boolean(),
		}),
		scopes: z.array(personScopeSchema),
		payments: z.array(personPaymentSchema),
		/** The newest shared expenses; the rest are at GET /people/{type}/{id}/ledger. */
		rows: z.array(ledgerRowSchema),
		rowCount: z.int().min(0),
		stats: z.object({
			since: daySchema.nullable(),
			expenses: z.int().min(0),
			projects: z.int().min(0),
		}),
		needs: z.array(needsItemSchema),
	})
	.meta({ id: "PersonPage" });

// ── The Settle up sheet's read ──────────────────────────────────────────────

/** `scope` in the settle read: omitted is every scope, this word is Outside projects. */
export const OUTSIDE_PROJECTS = "outside";

export const settleContextQuerySchema = z.object({
	direction: z.enum(["outgoing", "incoming"]).optional(),
	currency: z
		.string()
		.regex(/^[A-Z0-9]{2,10}$/)
		.optional(),
	rateType: z.string().min(1).max(32).optional(),
	scope: z
		.string()
		.min(1)
		.max(64)
		.optional()
		.meta({
			description: `A project id, or "${OUTSIDE_PROJECTS}" for Outside projects. Omitted: every scope.`,
		}),
});

export const settleContextSchema = z
	.object({
		home: z.string(),
		/** The payment currency the sheet starts in. */
		currency: z.string(),
		currencies: z.array(z.string()),
		direction: z.enum(["outgoing", "incoming"]),
		/** Which way the open balance points; null when nothing is open. */
		suggested: z.enum(["outgoing", "incoming"]).nullable(),
		lines: z.array(
			z.object({ project: projectRefSchema.nullable(), amount: moneySchema }),
		),
		/** "Everything" in the payment currency for this direction. */
		everything: moneySchema.nullable(),
		/** One fill per currency part, when more than one currency is owed that way. */
		parts: z.array(z.object({ currency: z.string(), full: moneySchema })),
		rates: z.array(
			z.object({ currency: z.string(), rate: rateViewSchema.nullable() }),
		),
		rateTypes: z.array(z.string()),
		/** Currencies owed that way with no rate: left out of Everything. */
		unpriced: z.array(z.string()),
		today: daySchema,
		yesterday: daySchema,
	})
	.meta({ id: "SettleContext" });
