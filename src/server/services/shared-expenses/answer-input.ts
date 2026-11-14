/**
 * Contract for answering your own share of a split expense on the web
 * (`verification.answer` and `verification.restoreAnswer`, each a preview and
 * save pair). The reason is user text, kept as typed. The undo token is the
 * signed one a save returns (entry/restore-token.ts), never composed here.
 */
import { userTextOrEmpty } from "@retrospend/api-contract/common";
import { z } from "zod";
import { signedRestore } from "../entry/input";

export const answerShareInputSchema = z.object({
	txnId: z.string().min(1).max(64),
	answer: z.enum(["accept", "reject"]),
	reason: userTextOrEmpty("shared_expense.reject_reason", 500).optional(),
});

export const restoreAnswerInputSchema = z.object({ restore: signedRestore });
