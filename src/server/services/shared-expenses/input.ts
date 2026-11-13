/** Transport schemas the shared expense procedures share. */
import { userText } from "@retrospend/api-contract/common";
import { z } from "zod";
import { participantRefSchema } from "../payments/input";

export const splitParticipantSchema = participantRefSchema.extend({
	shareAmount: z.number().nonnegative().optional(),
	sharePercentage: z.number().min(0).max(100).optional(),
	shareUnits: z.number().int().positive().optional(),
});

export const splitModeEnum = z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]);

/**
 * A receipt link. `userText` first: a bare `z.url()` takes a leading U+0001 (the
 * marker of a sealed value) and control characters inside the link.
 */
const receiptText = userText("shared_expense.receiptUrl", 2048);
export const receiptUrlSchema = receiptText.pipe(z.url());
