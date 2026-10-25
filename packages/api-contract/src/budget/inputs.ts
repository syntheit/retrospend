/** Inputs shared by the budget writes: targets, rules, setup, movements. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { userText } from "../common/user-text";
import { idSchema } from "../core";
import {
	billRepeatSchema,
	clientIdSchema,
	envelopeKindSchema,
	groupRoleSchema,
	isoDateSchema,
	monthKeySchema,
	nonNegativeAmount,
	positiveAmount,
	setupStyleSchema,
	signedAmount,
	targetCadenceSchema,
	targetModeSchema,
} from "./basics";

/** Amounts are decimal text in `currency` (default: the book currency, D25). */
export const targetInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("MONTHLY"),
		amount: nonNegativeAmount,
		mode: targetModeSchema.default("REFILL"),
		cadence: targetCadenceSchema.default("MONTH"),
		currency: z.string().min(3).max(10).optional(),
	}),
	z.object({
		kind: z.literal("BILL"),
		amount: positiveAmount,
		dueDate: isoDateSchema,
		repeat: billRepeatSchema.nullable(),
		currency: z.string().min(3).max(10).optional(),
	}),
	z.object({
		kind: z.literal("BILL_TEMPLATE"),
		templateId: idSchema,
	}),
	/** A bill that follows a liability's minimum and due day (SPEC §5.4, §5.11). */
	z.object({
		kind: z.literal("BILL_LIABILITY"),
		liabilityId: idSchema,
	}),
	z.object({
		kind: z.literal("SAVINGS"),
		amount: positiveAmount.optional(),
		dueDate: isoDateSchema.optional(),
		monthly: positiveAmount.optional(),
		currency: z.string().min(3).max(10).optional(),
	}),
]);

/** A group's target (SPEC §5.9): a fixed amount or a percent of money in (basis points). */
export const groupTargetInputSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("NONE") }),
	z.object({ kind: z.literal("AMOUNT"), amount: positiveAmount }),
	z.object({
		kind: z.literal("PERCENT_OF_INCOME"),
		basisPoints: z.number().int().min(1).max(10_000),
	}),
]);

/** What an income rule matches (SPEC §5.10). TITLE is the one rule that reads titles (E2EE known exception). */
export const ruleMatchSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ANY") }),
	z.object({ kind: z.literal("CATEGORY"), categoryId: idSchema }),
	z.object({ kind: z.literal("TEMPLATE"), templateId: idSchema }),
	z.object({
		kind: z.literal("TITLE"),
		contains: userText("incomeRule.matchTitle", 128),
	}),
	z.object({
		kind: z.literal("CURRENCY"),
		currency: z.string().min(3).max(10),
	}),
]);

export const ruleActionInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("PERCENT"),
		basisPoints: z.number().int().min(1).max(10_000),
	}),
	z.object({ kind: z.literal("AMOUNT"), amount: positiveAmount }),
	z.object({ kind: z.literal("REMAINDER") }),
]);

export const setupRuleSchema = z.object({
	name: userText("incomeRule.name", 64),
	match: ruleMatchSchema,
	action: ruleActionInputSchema,
	envelopeKey: z.string().min(1).max(32),
});

/** A rule a style proposes: the name is a message key the client translates and sends back. */
export const presetRuleSchema = setupRuleSchema
	.omit({ name: true })
	.extend({ nameKey: z.string() });

export const monthInputSchema = z
	.object({ month: monthKeySchema.optional() })
	.default({});

export const payFrequencySchema = z.enum([
	"MONTHLY",
	"EVERY_TWO_WEEKS",
	"WEEKLY",
	"VARIES",
]);

/** How you are paid (the pay step): a pay date the cycle counts from, unless it varies. */
export const setupPaySchema = z
	.object({
		frequency: payFrequencySchema,
		nextPay: isoDateSchema.nullable(),
	})
	.refine(
		(p) => (p.frequency === "VARIES") === (p.nextPay === null),
		"a pay date goes with every cycle except It varies",
	);

/** Pay off debt: the plan saved in the same write as the book (SPEC §5.11). */
export const setupPayoffSchema = z.object({
	strategy: z.enum(["AVALANCHE", "SNOWBALL"]),
	/** Each month on top of the minimums; becomes the extra envelope's Set aside target. */
	extraMonthly: nonNegativeAmount,
	/** The envelope of this setup that holds the extra (Monthly). */
	envelopeKey: z.string().min(1).max(32),
});

export const setupInputSchema = z
	.object({
		style: setupStyleSchema,
		currency: z.string().min(3).max(10).optional(),
		weekStartDay: z.number().int().min(0).max(6).optional(),
		/** "How much money do you have right now?" in the book currency (D34). */
		startingMoney: nonNegativeAmount.optional(),
		groups: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: userText("budgetGroup.name", 64),
					role: groupRoleSchema.nullable(),
					target: groupTargetInputSchema.optional(),
				}),
			)
			.max(20),
		/** Income rules the style starts with (Save first), in order. */
		rules: z.array(setupRuleSchema).max(20).optional(),
		/** The pay step: how often you are paid, so the plan can start from the next pay. */
		pay: setupPaySchema.optional(),
		/** Pay off debt only. */
		payoff: setupPayoffSchema.optional(),
		envelopes: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: userText("envelope.name", 64),
					groupKey: z.string().min(1).max(32).nullable(),
					kind: envelopeKindSchema,
					isDefault: z.boolean().default(false),
					icon: z.string().max(32).optional(),
					categoryIds: z.array(idSchema).max(200).default([]),
					target: targetInputSchema.optional(),
					/** Leftovers sweep to this envelope at close (SPEC §5.7, asked in Save first). */
					sweepToKey: z.string().min(1).max(32).optional(),
				}),
			)
			.min(1)
			.max(200),
	})
	.refine(
		(s) => s.envelopes.filter((e) => e.isDefault).length === 1,
		"exactly one envelope is the default (Everything else)",
	)
	.refine(
		(s) => s.style !== "LIMITS" || s.startingMoney === undefined,
		"Limits does not ask for money now (SPEC §4.3)",
	)
	.refine(
		(s) => s.payoff === undefined || s.style === "DEBT_PAYOFF",
		"a payoff plan goes with the Pay off debt style",
	)
	.refine(
		(s) =>
			s.payoff === undefined ||
			s.envelopes.some(
				(e) => e.key === s.payoff?.envelopeKey && e.kind === "MONTHLY",
			),
		"the payoff plan's extra goes to a Monthly envelope of this setup",
	);

export const assignInputSchema = z.object({
	batchId: clientIdSchema,
	month: monthKeySchema,
	/** add: change Assigned by the amount (negative takes back, capped). set: make Assigned this amount. */
	mode: z.enum(["add", "set"]),
	items: z
		.array(
			z.object({
				id: clientIdSchema,
				envelopeId: idSchema,
				amount: signedAmount,
			}),
		)
		.min(1)
		.max(200)
		.refine(
			(items) => new Set(items.map((i) => i.envelopeId)).size === items.length,
			"an envelope appears once per batch",
		)
		.refine(
			(items) => new Set(items.map((i) => i.id)).size === items.length,
			"every item has its own id",
		),
});

export const moveInputSchema = z.object({
	id: clientIdSchema,
	month: monthKeySchema,
	/** null = To assign. */
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amount: positiveAmount,
	kind: z.enum(["MOVE", "COVER", "UNASSIGN"]),
});

export const coverInputSchema = z.object({
	id: clientIdSchema,
	month: monthKeySchema,
	envelopeId: idSchema,
	/** null = from To assign. */
	from: idSchema.nullable(),
	amount: positiveAmount,
});

export const undoInputSchema = z.object({
	/** Batch id for the mirror rows; a retry with the same id is a no-op. */
	id: clientIdSchema,
	target: z.union([
		z.object({ movementId: idSchema }),
		z.object({ batchId: idSchema }),
	]),
});

export const coverSourcesInputSchema = z.object({
	month: monthKeySchema.optional(),
	envelopeId: idSchema,
});

export const historyInputSchema = z.object({
	month: monthKeySchema.optional(),
	envelopeId: idSchema.optional(),
	cursor: idSchema.optional(),
	limit: z.number().int().min(1).max(100).default(50),
});
