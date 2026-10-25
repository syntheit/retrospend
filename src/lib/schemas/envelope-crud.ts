/**
 * Contract for envelope edits (budget stream 2B; SPEC §3, §5.4, §5.13 history,
 * §8.2, D65): set a target, create, update, combine and archive an envelope,
 * confirm starting money, undo any of them, "Can I afford it?" and the shares
 * that found no category. Same conventions as ./envelope: Money DTOs in
 * integer minor units, months as YYYYMM, write inputs carry client ids.
 *
 * Each edit is a preview and apply pair of one mutation (R30). What an edit
 * changed is stored server side (envelope_change), so its undo is exact and a
 * client never sends the old state back.
 */
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";
import {
	envelopeKindSchema,
	isoDateSchema,
	minorSchema,
	moneySchema,
	monthKeySchema,
	movementResultSchema,
	targetInputSchema,
} from "./envelope";
import { targetSnapshotSchema } from "./envelope-book";

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const positiveMinor = minorSchema.refine((v) => v > 0, "must be above 0");
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");

/** A category link that moved: from the envelope that had it (null: none) to the one that has it now (null: none). */
export const routedCategorySchema = z.object({
	categoryId: idSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
});

/** An envelope's Left in the current month before and after an edit (RC-5: every line listed). */
const leftChangeSchema = z.object({
	id: idSchema,
	before: moneySchema,
	after: moneySchema,
});

const changeIdSchema = z.object({
	/** Client id of the edit: a retry is a no-op, and it names the edit for its undo. */
	id: clientIdSchema,
});

// ── Target ──────────────────────────────────────────────────────────────────

export const setTargetInputSchema = changeIdSchema
	.extend({
		envelopeId: idSchema,
		/** What it is for. NONE has no target; the others take the matching target input. */
		kind: envelopeKindSchema,
		/** Monthly: amount, mode, cadence. Bill: amount, due date, repeat, or follows a recurring expense or a debt. Savings: any two of amount, date, monthly. A foreign `currency` stays as typed (D25). */
		target: targetInputSchema.nullable(),
	})
	.refine((v) => (v.kind === "NONE") === (v.target === null), {
		message: "No target takes no target input, every other kind takes one",
		path: ["target"],
	});

export const setTargetResultSchema = z.object({
	changeId: idSchema,
	envelopeId: idSchema,
	/** The stored target now. */
	target: targetSnapshotSchema,
	/** The stored target before: what the undo writes back. */
	previous: targetSnapshotSchema,
	/** As typed, in its own currency (a foreign target keeps it); null without an amount. */
	typed: moneySchema.nullable(),
	/** The same target in the book currency at today's rate; null without an amount or a rate. */
	inBook: moneySchema.nullable(),
	/** A foreign target with no rate today (R14): the need reads 0 and says so. */
	incomplete: z.boolean(),
});

// ── Create, update, combine, archive ───────────────────────────────────────

export const createEnvelopeInputSchema = z.object({
	/** Client id of the new envelope; it names the edit for its undo too. */
	id: clientIdSchema,
	name: userText("envelope.name", 64),
	/** null: no group. */
	groupId: idSchema.nullable(),
	kind: envelopeKindSchema.default("NONE"),
	/** Needs the matching kind; omitted: no target. */
	target: targetInputSchema.optional(),
	/** A category lives in one envelope, so it moves here from where it was. */
	categoryIds: z.array(idSchema).max(200).default([]),
	icon: z.string().max(32).optional(),
});

const routedResult = {
	changeId: idSchema,
	/** Categories whose link moved. Closed months keep the routing they closed with (B7). */
	routed: z.array(routedCategorySchema),
};

export const createEnvelopeResultSchema = movementResultSchema.extend({
	...routedResult,
	envelopeId: idSchema,
	/** Current-month Left of every envelope the edit touched, each as before and after. */
	left: z.array(leftChangeSchema),
});

export const updateEnvelopeInputSchema = changeIdSchema
	.extend({
		envelopeId: idSchema,
		name: userText("envelope.name", 64).optional(),
		/** null: out of its group. */
		groupId: idSchema.nullable().optional(),
		/** The full list of categories it covers. */
		categoryIds: z.array(idSchema).max(200).optional(),
	})
	.refine(
		(v) =>
			v.name !== undefined ||
			v.groupId !== undefined ||
			v.categoryIds !== undefined,
		{ message: "Nothing to change" },
	);

export const updateEnvelopeResultSchema = movementResultSchema.extend({
	...routedResult,
	envelopeId: idSchema,
	renamed: z.object({ from: z.string(), to: z.string() }).nullable(),
	group: z
		.object({ from: idSchema.nullable(), to: idSchema.nullable() })
		.nullable(),
	left: z.array(leftChangeSchema),
});

export const mergeEnvelopesInputSchema = changeIdSchema
	.extend({
		/** The envelope that stays and takes the others' money, categories, rules and targets. */
		intoId: idSchema,
		fromIds: z.array(idSchema).min(1).max(20),
		/** A new name for the envelope that stays. */
		name: userText("envelope.name", 64).optional(),
	})
	.refine((v) => new Set(v.fromIds).size === v.fromIds.length, {
		message: "an envelope appears once",
		path: ["fromIds"],
	})
	.refine((v) => !v.fromIds.includes(v.intoId), {
		message: "an envelope cannot be combined into itself",
		path: ["fromIds"],
	});

export const mergeEnvelopesResultSchema = movementResultSchema.extend({
	...routedResult,
	intoId: idSchema,
	fromIds: z.array(idSchema),
	renamed: z.object({ from: z.string(), to: z.string() }).nullable(),
	left: z.array(leftChangeSchema),
	rules: z.array(idSchema),
	projectRoutes: z.array(idSchema),
	/** Envelopes whose leftovers swept to a combined one and now sweep to the one that stays. */
	sweeps: z.array(idSchema),
	groupMains: z.array(idSchema),
	payoffPlan: z.boolean(),
	/** The stayer's target before and after; `summed` counts the targets added to it, `dropped` the ones that could not be. */
	target: z.object({
		before: targetSnapshotSchema,
		after: targetSnapshotSchema,
		summed: z.number().int().min(0),
		dropped: z.number().int().min(0),
	}),
});

export const archiveEnvelopeInputSchema = changeIdSchema.extend({
	envelopeId: idSchema,
});

export const archiveEnvelopeResultSchema = movementResultSchema.extend({
	...routedResult,
	envelopeId: idSchema,
	left: z.array(leftChangeSchema),
	/** Active income rules that named it: their lines are left out from now on. */
	rulesLeftOut: z.array(idSchema),
	/** Projects that counted your shares in it: they count by category now. */
	projectRoutes: z.array(idSchema),
});

// ── Starting money (D34) ────────────────────────────────────────────────────

export const confirmStartingMoneyInputSchema = changeIdSchema.extend({
	/** "How much do you have right now?" in the book currency; 0 is an answer. */
	amountMinor: nonNegativeMinor,
});

export const confirmStartingMoneyResultSchema = z.object({
	changeId: idSchema,
	amount: moneySchema,
	/** The money in row written; null for 0. */
	expenseId: idSchema.nullable(),
	confirmedAt: z.date(),
});

// ── Undo ────────────────────────────────────────────────────────────────────

export const undoChangeInputSchema = z.object({
	/** The id of the edit to undo (the `changeId` it returned). */
	id: idSchema,
});

export const undoChangeResultSchema = movementResultSchema.extend({
	changeId: idSchema,
	kind: z.enum([
		"SET_TARGET",
		"CREATE",
		"UPDATE",
		"MERGE",
		"ARCHIVE",
		"CONFIRM_STARTING_MONEY",
	]),
	envelopeId: idSchema.nullable(),
});

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

export type SetTargetInput = z.infer<typeof setTargetInputSchema>;
export type SetTargetResult = z.infer<typeof setTargetResultSchema>;
export type CreateEnvelopeInput = z.infer<typeof createEnvelopeInputSchema>;
export type CreateEnvelopeResult = z.infer<typeof createEnvelopeResultSchema>;
export type UpdateEnvelopeInput = z.infer<typeof updateEnvelopeInputSchema>;
export type UpdateEnvelopeResult = z.infer<typeof updateEnvelopeResultSchema>;
export type MergeEnvelopesInput = z.infer<typeof mergeEnvelopesInputSchema>;
export type MergeEnvelopesResult = z.infer<typeof mergeEnvelopesResultSchema>;
export type ArchiveEnvelopeInput = z.infer<typeof archiveEnvelopeInputSchema>;
export type ArchiveEnvelopeResult = z.infer<typeof archiveEnvelopeResultSchema>;
export type ConfirmStartingMoneyInput = z.infer<
	typeof confirmStartingMoneyInputSchema
>;
export type ConfirmStartingMoneyResult = z.infer<
	typeof confirmStartingMoneyResultSchema
>;
export type UndoChangeInput = z.infer<typeof undoChangeInputSchema>;
export type UndoChangeResult = z.infer<typeof undoChangeResultSchema>;
export type AffordInput = z.infer<typeof affordInputSchema>;
export type AffordResult = z.infer<typeof affordResultSchema>;
export type AffordState = z.infer<typeof affordStateSchema>;
export type UnroutedSharesInput = z.infer<typeof unroutedSharesInputSchema>;
export type UnroutedSharesOutput = z.infer<typeof unroutedSharesOutputSchema>;
export type RoutedCategory = z.infer<typeof routedCategorySchema>;
