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
	minorSchema,
	monthKeySchema,
	nonNegativeMinor,
	positiveMinor,
	setupStyleSchema,
	targetCadenceSchema,
	targetModeSchema,
} from "./basics";

/** Amounts are minor units of `currency` (default: the book currency, D25). */
export const targetInputSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("MONTHLY"),
		amountMinor: nonNegativeMinor,
		mode: targetModeSchema.default("REFILL"),
		cadence: targetCadenceSchema.default("MONTH"),
		currency: z.string().min(3).max(10).optional(),
	}),
	z.object({
		kind: z.literal("BILL"),
		amountMinor: positiveMinor,
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
		amountMinor: positiveMinor.optional(),
		dueDate: isoDateSchema.optional(),
		monthlyMinor: positiveMinor.optional(),
		currency: z.string().min(3).max(10).optional(),
	}),
]);

/** A group's target (SPEC §5.9): a fixed amount or a percent of money in (basis points). */
export const groupTargetInputSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("NONE") }),
	z.object({ kind: z.literal("AMOUNT"), amountMinor: positiveMinor }),
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
	z.object({ kind: z.literal("AMOUNT"), amountMinor: positiveMinor }),
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

export const setupInputSchema = z
	.object({
		style: setupStyleSchema,
		currency: z.string().min(3).max(10).optional(),
		weekStartDay: z.number().int().min(0).max(6).optional(),
		/** "How much money do you have right now?" in the book currency (D34). */
		startingMoneyMinor: nonNegativeMinor.optional(),
		groups: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: z.string().min(1).max(64),
					role: groupRoleSchema.nullable(),
					target: groupTargetInputSchema.optional(),
				}),
			)
			.max(20),
		/** Income rules the style starts with (Save first), in order. */
		rules: z.array(setupRuleSchema).max(20).optional(),
		envelopes: z
			.array(
				z.object({
					key: z.string().min(1).max(32),
					name: z.string().min(1).max(64),
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
		(s) => s.style !== "LIMITS" || s.startingMoneyMinor === undefined,
		"Limits does not ask for money now (SPEC §4.3)",
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
				amountMinor: minorSchema,
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
	amountMinor: positiveMinor,
	kind: z.enum(["MOVE", "COVER", "UNASSIGN"]),
});

export const coverInputSchema = z.object({
	id: clientIdSchema,
	month: monthKeySchema,
	envelopeId: idSchema,
	/** null = from To assign. */
	from: idSchema.nullable(),
	amountMinor: positiveMinor,
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
