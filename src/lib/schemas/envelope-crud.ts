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
import {
	affordActionSchema,
	affordResultSchema,
	affordStateSchema,
	archiveEnvelopeResultSchema as contractArchiveEnvelopeResultSchema,
	confirmStartingMoneyResultSchema as contractConfirmStartingMoneyResultSchema,
	createEnvelopeResultSchema as contractCreateEnvelopeResultSchema,
	mergeEnvelopesResultSchema as contractMergeEnvelopesResultSchema,
	undoChangeResultSchema as contractUndoChangeResultSchema,
	updateEnvelopeResultSchema as contractUpdateEnvelopeResultSchema,
	routedCategorySchema,
	setTargetResultSchema,
	unroutedShareSchema,
	unroutedSharesOutputSchema,
} from "@retrospend/api-contract/budget";
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";
import {
	envelopeKindSchema,
	minorSchema,
	monthKeySchema,
	movementResultSchema,
	targetInputSchema,
} from "./envelope";

export {
	affordActionSchema,
	affordResultSchema,
	affordStateSchema,
	routedCategorySchema,
	setTargetResultSchema,
	unroutedShareSchema,
	unroutedSharesOutputSchema,
};

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();
const positiveMinor = minorSchema.refine((v) => v > 0, "must be above 0");
const nonNegativeMinor = minorSchema.refine((v) => v >= 0, "must be 0 or more");

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

export const createEnvelopeResultSchema =
	contractCreateEnvelopeResultSchema.extend({
		movements: movementResultSchema.shape.movements,
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

export const updateEnvelopeResultSchema =
	contractUpdateEnvelopeResultSchema.extend({
		movements: movementResultSchema.shape.movements,
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

export const mergeEnvelopesResultSchema =
	contractMergeEnvelopesResultSchema.extend({
		movements: movementResultSchema.shape.movements,
	});

export const archiveEnvelopeInputSchema = changeIdSchema.extend({
	envelopeId: idSchema,
});

export const archiveEnvelopeResultSchema =
	contractArchiveEnvelopeResultSchema.extend({
		movements: movementResultSchema.shape.movements,
	});

// ── Starting money (D34) ────────────────────────────────────────────────────

export const confirmStartingMoneyInputSchema = changeIdSchema.extend({
	/** "How much do you have right now?" in the book currency; 0 is an answer. */
	amountMinor: nonNegativeMinor,
});

export const confirmStartingMoneyResultSchema =
	contractConfirmStartingMoneyResultSchema.extend({ confirmedAt: z.date() });

// ── Undo ────────────────────────────────────────────────────────────────────

export const undoChangeInputSchema = z.object({
	/** The id of the edit to undo (the `changeId` it returned). */
	id: idSchema,
});

export const undoChangeResultSchema = contractUndoChangeResultSchema.extend({
	movements: movementResultSchema.shape.movements,
});

// ── Can I afford it? (SYNTHESIS-r6 §4) ──────────────────────────────────────

export const affordInputSchema = z.object({
	month: monthKeySchema.optional(),
	/** In the book currency. */
	amountMinor: positiveMinor,
	/** Every dollar and Limits answer from one envelope (default: Everything else). */
	envelopeId: idSchema.optional(),
});

// ── Shares with no envelope (SPEC §5.8, §5.14) ──────────────────────────────

export const unroutedSharesInputSchema = z
	.object({ limit: z.number().int().min(1).max(200).default(100) })
	.default({ limit: 100 });

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
