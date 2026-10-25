/**
 * Contract for corrections, Ask to fix and the Forgive audit (2C.2,
 * MONEY-MOVES 1.11, 1.12): the zod inputs and outputs of every
 * `corrections.*` procedure. Same rules as the envelope contract: money is
 * integer minor units computed on the server, ids are made by the client
 * (retries are idempotent), free text is declared through `userText`.
 *
 * Forgive keeps its envelope contract (`forgiveInputSchema`); the
 * `corrections.forgive*` procedures take the same input.
 */
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";
import { minorSchema, participantRefSchema } from "./envelope";

const idSchema = z.string().min(1).max(64);
const clientIdSchema = z.string().uuid();

/** A decimal amount in the expense's currency, as typed ("48000.00"). */
const decimalAmount = z.string().regex(/^\d{1,15}(\.\d{1,8})?$/);

export const fixRequestStatusSchema = z.enum([
	"PENDING",
	"ACCEPTED",
	"DECLINED",
	"FIXED",
	"CANCELLED",
]);

const splitLineSchema = z.object({
	participant: participantRefSchema,
	shareAmount: decimalAmount.optional(),
	sharePercentage: z.number().min(0).max(100).optional(),
	shareUnits: z.number().int().min(0).optional(),
});

/** What the split should be now; the server works out the difference. */
export const correctInputSchema = z.object({
	/** Client id of the correction: row ids derive from it, so a retry writes nothing twice. */
	id: clientIdSchema,
	/** The split to correct (an original, never a correction row). */
	transactionId: idSchema,
	/** The correction's own title; the client writes "Correction to ..." (the server never reads titles). */
	description: userText("sharedExpense.correctionTitle", 500),
	amount: decimalAmount,
	paidBy: participantRefSchema,
	categoryId: idSchema.nullable(),
	splitMode: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]),
	splitWith: z.array(splitLineSchema).min(1).max(100),
});

const differenceSchema = z.object({
	participant: participantRefSchema,
	/** Positive: paid more than before. */
	paidMinor: minorSchema,
	/** Positive: owes more than before. */
	shareMinor: minorSchema,
});

const resolvedRequestSchema = z.object({
	id: idSchema,
	previousStatus: fixRequestStatusSchema,
});

export const correctResultSchema = z.object({
	/** The correction rows written (empty when nothing changed). */
	transactionIds: z.array(idSchema),
	currency: z.string(),
	/** One line per person whose paid or share moved: the sheet states each before Save. */
	differences: z.array(differenceSchema),
	/** Open Ask to fix requests this correction answered. */
	resolvedRequests: z.array(resolvedRequestSchema),
});

export const undoCorrectionInputSchema = z.object({
	transactionIds: z.array(idSchema).min(1).max(20),
	resolvedRequests: z.array(resolvedRequestSchema).max(50),
});

export const askToFixInputSchema = z.object({
	/** Client id of the request. */
	id: clientIdSchema,
	transactionId: idSchema,
	message: userText("fixRequest.message", 1000).optional(),
});

export const respondToFixInputSchema = z.object({
	id: clientIdSchema,
	response: z.enum(["accept", "decline"]),
	reply: userText("fixRequest.reply", 1000).optional(),
});

export const cancelFixInputSchema = z.object({ id: clientIdSchema });

/** Undo of an answer or a cancel: puts the request back to the status it had. */
export const restoreFixInputSchema = z.object({
	id: clientIdSchema,
	status: z.enum(["PENDING", "ACCEPTED"]),
});

export const fixRequestSchema = z.object({
	id: idSchema,
	transactionId: idSchema,
	requestedBy: participantRefSchema,
	asked: participantRefSchema,
	message: z.string().nullable(),
	reply: z.string().nullable(),
	status: fixRequestStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
	answeredAt: z.string().nullable(),
});

export const fixRequestResultSchema = z.object({
	request: fixRequestSchema,
	/** The status before this write; undo restores it. */
	previousStatus: fixRequestStatusSchema.nullable(),
});

export const fixRequestsInputSchema = z.object({ transactionId: idSchema });

export const lockStateSchema = z.object({
	transactionId: idSchema,
	locked: z.boolean(),
	/** SETTLED: a payment brought the scope to zero. PERIOD: a billing period closed. */
	reason: z.enum(["SETTLED", "PERIOD"]).nullable(),
	/** The creator corrects; everyone else on the split asks to fix. */
	canCorrect: z.boolean(),
	canAskToFix: z.boolean(),
	/** This row corrects another split (it cannot be edited; undo the correction). */
	correctsId: idSchema.nullable(),
	/** Correction rows written for this split. */
	corrections: z.number().int(),
});

export type CorrectInput = z.infer<typeof correctInputSchema>;
export type CorrectResult = z.infer<typeof correctResultSchema>;
export type UndoCorrectionInput = z.infer<typeof undoCorrectionInputSchema>;
export type AskToFixInput = z.infer<typeof askToFixInputSchema>;
export type RespondToFixInput = z.infer<typeof respondToFixInputSchema>;
export type CancelFixInput = z.infer<typeof cancelFixInputSchema>;
export type RestoreFixInput = z.infer<typeof restoreFixInputSchema>;
export type FixRequestDto = z.infer<typeof fixRequestSchema>;
export type FixRequestResult = z.infer<typeof fixRequestResultSchema>;
export type LockStateDto = z.infer<typeof lockStateSchema>;
