import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { idSchema } from "../core";
import { daySchema } from "../ledger";

const TAG = ["Needs you"];

export const NEEDS_YOU_GROUPS = [
	"people",
	"activity",
	"budget",
	"setup",
] as const;

/** Mirrors NeedsYouType in src/server/services/needs-you/types.ts (a server type check keeps them equal). */
export const NEEDS_YOU_TYPES = [
	"payment.confirm",
	"split.review",
	"split.rejected",
	"split.fixRequested",
	"recurring.overdue",
	"recurring.due",
	"import.review",
	"budget.giveJob",
	"budget.overAssigned",
	"budget.overspent",
	"budget.billDue",
	"budget.debtDue",
	"budget.sharesNeedEnvelope",
	"budget.monthSummary",
	"budget.monthChanged",
	"budget.startingMoney",
	"people.owedAging",
	"budget.missingRate",
	"budget.hiddenReview",
	"budget.reconcile",
	"setup.firstExpense",
	"setup.homeCurrency",
	"setup.verifyEmail",
	"setup.importStatement",
] as const;

export const NEEDS_YOU_ENTITY_KINDS = [
	"payment",
	"sharedExpense",
	"recurring",
	"importJob",
	"envelope",
	"book",
	"user",
] as const;

export const needsYouGroupSchema = z.enum(NEEDS_YOU_GROUPS);

const sourceSchema = z.object({
	entryId: idSchema,
	kind: z.enum(["INCOME", "STARTING_BALANCE"]),
	title: z.string(),
	date: daySchema,
	amount: moneySchema,
	/** How much of it is still without a job. */
	part: moneySchema,
});

export const needsYouItemSchema = z
	.object({
		/** Stable across reads: `<type>:<entity id>`, or the type alone. */
		id: z.string(),
		type: z.enum(NEEDS_YOU_TYPES),
		group: needsYouGroupSchema,
		/** What the primary action acts on; null for setup prompts. */
		entity: z
			.object({ kind: z.enum(NEEDS_YOU_ENTITY_KINDS), id: z.string() })
			.nullable(),
		/** Every entity an aggregated item stands for. */
		entityIds: z.array(z.string()),
		/** Person keys of the faces to show, in order; identities are in `people`. */
		people: z.array(z.string()),
		/** Never netted across currencies; null when the type has none. */
		amount: moneySchema.nullable(),
		count: z.int().nullable(),
		date: daySchema.nullable(),
		/** A title the user typed, never UI copy. */
		title: z.string().nullable(),
		attention: z.boolean(),
		/** The primary action first. */
		actions: z.array(z.object({ entity: z.string(), id: z.string() })),
		direction: z.enum(["in", "out"]).nullable(),
		askAmount: z.boolean(),
		/** budget.missingRate: the currencies without a rate. */
		currencies: z.array(currencyCodeSchema),
		/** budget.giveJob: the money that arrived and has no job yet, newest first. */
		sources: z.array(sourceSchema),
	})
	.meta({ id: "NeedsYouItem" });

export const needsYouListSchema = z
	.object({
		today: daySchema,
		/** One ordered list. The client words each item from its type and facts. */
		items: z.array(needsYouItemSchema),
		/** Items per group plus the total: the nav badges. */
		counts: z.object({
			people: z.int(),
			activity: z.int(),
			budget: z.int(),
			setup: z.int(),
			total: z.int(),
		}),
		/** Faces by person key. */
		people: z.record(
			z.string(),
			z.object({
				key: z.string(),
				name: z.string(),
				imageUrl: z.string().nullable(),
				onRetrospend: z.boolean(),
			}),
		),
	})
	.meta({ id: "NeedsYouList" });

export const needsYouContract = {
	list: v1
		.route({
			method: "GET",
			path: "/needs-you",
			operationId: "getNeedsYou",
			tags: TAG,
			summary: "What waits for you, in one ordered list",
			description:
				"Splits to review, payments to confirm, recurring entries due, import review, fix requests, budget prompts (with the envelope budget on) and setup prompts. The server sends facts; the client words each item.",
		})
		.meta({ scope: "read" })
		.output(needsYouListSchema),
};
