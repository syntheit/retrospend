/** Drafts: Plan next month and What if. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { idSchema, timestampSchema } from "../core";
import {
	clientIdSchema,
	monthKeySchema,
	nonNegativeAmount,
	positiveAmount,
} from "./basics";
import { movementResultSchema } from "./read";

// ── Drafts: Plan next month and What if (SPEC §5.13, D2, D54) ───────────────

export const draftKindSchema = z.enum(["PLAN", "WHAT_IF"]);
export const draftStatusSchema = z.enum(["OPEN", "APPLIED", "DISCARDED"]);

/** PLAN: what the envelope should have assigned in the month. */
export const planLineSchema = z.object({
	envelopeId: idSchema,
	amount: nonNegativeAmount,
});

/** WHAT_IF: a pretend move; Apply writes only these (D54). null = To assign. */
export const draftMoveSchema = z.object({
	id: clientIdSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
	amount: positiveAmount,
});

/** Expected money in: sizes the plan, never written as money in (D16). */
export const expectedInSchema = z.object({
	id: clientIdSchema,
	templateId: idSchema.nullable(),
	categoryId: idSchema.nullable(),
	amount: positiveAmount,
});

/** WHAT_IF: a pretend expense (OUT) or money in (IN), never written. */
export const pretendRowSchema = z.object({
	id: clientIdSchema,
	kind: z.enum(["OUT", "IN"]),
	categoryId: idSchema.nullable(),
	/** OUT straight into one envelope ("What if I spend…" on an envelope). */
	envelopeId: idSchema.nullable(),
	amount: positiveAmount,
});

/** The same four rows as a draft answers them: amounts as Money in the book currency. */
const withMoney = <S extends z.ZodRawShape>(shape: S) =>
	z.object({ ...shape, amount: moneySchema });
export const planLineOutSchema = withMoney({ envelopeId: idSchema });
export const draftMoveOutSchema = withMoney({
	id: clientIdSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
});
export const expectedInOutSchema = withMoney({
	id: clientIdSchema,
	templateId: idSchema.nullable(),
	categoryId: idSchema.nullable(),
});
export const pretendRowOutSchema = withMoney({
	id: clientIdSchema,
	kind: z.enum(["OUT", "IN"]),
	categoryId: idSchema.nullable(),
	envelopeId: idSchema.nullable(),
});

export const saveDraftInputSchema = z
	.object({
		id: clientIdSchema,
		kind: draftKindSchema,
		month: monthKeySchema,
		lines: z.array(planLineSchema).max(200).default([]),
		moves: z.array(draftMoveSchema).max(100).default([]),
		expectedIn: z.array(expectedInSchema).max(50).default([]),
		pretend: z.array(pretendRowSchema).max(100).default([]),
	})
	.refine(
		(d) => new Set(d.lines.map((l) => l.envelopeId)).size === d.lines.length,
		"an envelope appears once in a plan",
	)
	.refine(
		(d) =>
			d.kind === "WHAT_IF" || (d.moves.length === 0 && d.pretend.length === 0),
		"pretend rows and moves belong to What if",
	);

export const draftSchema = z.object({
	id: idSchema,
	kind: draftKindSchema,
	month: monthKeySchema,
	status: draftStatusSchema,
	lines: z.array(planLineOutSchema),
	moves: z.array(draftMoveOutSchema),
	expectedIn: z.array(expectedInOutSchema),
	pretend: z.array(pretendRowOutSchema),
	appliedAt: timestampSchema.nullable(),
	fundedBatchId: idSchema.nullable(),
	updatedAt: timestampSchema,
});

export const draftQueryInputSchema = z.object({
	kind: draftKindSchema,
	month: monthKeySchema.optional(),
});

export const draftsOutputSchema = z.object({
	month: monthKeySchema,
	/** The draft being edited, if any. */
	open: draftSchema.nullable(),
	/** PLAN: the saved plan Use my plan starts from when the month's money arrives. */
	saved: draftSchema.nullable(),
});

export const draftIdInputSchema = z.object({ draftId: idSchema });

/** "Fill from targets", "Same as this month", "What this month spent" (SPEC §5.13). */
export const planFillInputSchema = z.object({
	source: z.enum(["TARGETS", "SAME_AS_THIS_MONTH", "THIS_MONTH_SPENT"]),
});

export const planFillOutputSchema = z.object({
	month: monthKeySchema,
	lines: z.array(planLineOutSchema),
});

export const beforeAfter = z.object({
	before: moneySchema,
	after: moneySchema,
});

export const draftEnvelopeLineSchema = z.object({
	envelopeId: idSchema,
	assigned: beforeAfter,
	activity: beforeAfter,
	left: beforeAfter,
	/** The target's need with the draft in place. */
	need: moneySchema,
	/** Left below 0 with the draft in place. */
	short: z.boolean(),
});

export const draftPreviewSchema = z.object({
	draftId: idSchema,
	kind: draftKindSchema,
	month: monthKeySchema,
	/** The draft month's To assign (Not planned yet) without and with the draft. */
	toAssign: beforeAfter,
	/** Every envelope the draft moves (RC-5). */
	envelopes: z.array(draftEnvelopeLineSchema),
	/** Income rules previewed on expected and pretend money in. */
	ruleLines: z.array(
		z.object({
			sourceId: idSchema,
			ruleId: idSchema,
			envelopeId: idSchema,
			amount: moneySchema,
		}),
	),
	/** Envelopes that go short, each with a suggested cover. */
	shortfalls: z.array(
		z.object({
			envelopeId: idSchema,
			short: moneySchema,
			cover: z.array(
				z.object({ from: idSchema.nullable(), amount: moneySchema }),
			),
			/** Part of the shortfall nothing can cover. */
			uncovered: moneySchema,
		}),
	),
	/** PLAN: what "Fund it now" would take from this month's Not planned yet. */
	fundNow: moneySchema.nullable(),
	incomplete: z.boolean(),
	/** The draft names its month, which is no longer the current or next one. */
	stale: z.boolean(),
});

export const applyDraftInputSchema = z.object({
	draftId: idSchema,
	/** WHAT_IF: client id of the moves' batch. */
	batchId: clientIdSchema.optional(),
});

export const draftResultSchema = z.object({
	draft: draftSchema,
	/** PLAN: the saved plan this one replaced. */
	supersededId: idSchema.nullable(),
	/** The moves written (What if, Fund it now); null when nothing moved. */
	movement: movementResultSchema.nullable(),
});

export const fundNowInputSchema = z.object({
	draftId: idSchema,
	batchId: clientIdSchema,
});
