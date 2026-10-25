/** Envelope edits: targets, create, update, combine, archive, starting money, undo. Mirrors src/lib/schemas/envelope*.ts (a test keeps them equal). */
import * as z from "zod";
import { moneySchema } from "../common/money";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import {
	clientIdSchema,
	envelopeKindSchema,
	isoDateSchema,
	nonNegativeMinor,
} from "./basics";
import { targetSnapshotSchema } from "./book-write";
import { targetInputSchema } from "./inputs";
import { movementResultSchema } from "./read";

/** A category link that moved: from the envelope that had it (null: none) to the one that has it now (null: none). */
export const routedCategorySchema = z.object({
	categoryId: idSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
});

/** An envelope's Left in the current month before and after an edit (RC-5: every line listed). */
export const leftChangeSchema = z.object({
	id: idSchema,
	before: moneySchema,
	after: moneySchema,
});

export const changeIdSchema = z.object({
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

export const routedResult = {
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
	/** What you said you have right now. */
	amount: moneySchema,
	/** Signed: what you have minus what the budget held. Above 0 it is the money in row (what you have plus what was already spent since the start); below 0 the budget held more than you have and this is the OUT Adjustment. 0: no row. */
	booked: moneySchema,
	/** booked - amount: "Includes X already spent since <since>". Below 0 when money in was already recorded. */
	alreadySpent: moneySchema,
	/** The book's first day. */
	since: isoDateSchema,
	/** The money in row written; null when none was needed. */
	expenseId: idSchema.nullable(),
	/** The OUT Adjustment written when the budget held more than you have. */
	adjustmentId: idSchema.nullable(),
	confirmedAt: timestampSchema,
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
