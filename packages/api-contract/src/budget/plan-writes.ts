import * as z from "zod";
import { v1 } from "../common/meta";
import { undoTokenSchema } from "../common/preview";
import { idSchema } from "../core";
import { accountChangeSchema, previewTwin, undoInputSchema } from "../ledger";
import {
	acknowledgeMonthInputSchema,
	acknowledgeMonthResultSchema,
} from "./book-read";
import {
	adjustmentSchema,
	bookPeriodResultSchema,
	pauseResultSchema,
	revertLimitResultSchema,
	revertStyleResultSchema,
} from "./book-write";
import { undoChangeResultSchema } from "./crud-edits";
import { debtTermsResultSchema, payoffPlanResultSchema } from "./debt";
import { migrationStateSchema, resolveHiddenResultSchema } from "./migration";
import {
	draftIdInputSchema,
	draftResultSchema,
	draftSchema,
	saveDraftInputSchema,
} from "./plan-drafts";
import {
	createRuleInputSchema,
	incomeRuleSchema,
	reorderRulesInputSchema,
	ruleIdInputSchema,
	updateRuleInputSchema,
} from "./plan-rules";
import { groupTargetResultSchema } from "./plan-year";
import { movementResultSchema } from "./read";
import { planWrite, TAG } from "./routes";
import {
	projectRoutingResultSchema,
	shareCategoryResultSchema,
} from "./writes";

/**
 * Writes that move no money (a rule, a draft, a group's target, a debt's
 * terms, the payoff plan, the pause switch). They need `write:settings`, not
 * `write:money`, and have no preview or undo token: each answers with the
 * value it replaced where an edit can be put back by sending that value.
 */
const emptySchema = z.object({});

export const budgetPlanWrites = {
	acknowledgeMonth: planWrite({
		path: "/budget/months/acknowledge",
		operationId: "acknowledgeBudgetMonth",
		summary: "Mark a month's summary as read",
		event: "budget_book.month_acknowledged",
		input: acknowledgeMonthInputSchema,
		output: acknowledgeMonthResultSchema,
	}),
	pause: planWrite({
		path: "/budget/pause",
		operationId: "pauseBudget",
		summary: "Just track: keep the budget and go quiet",
		event: "budget_book.paused",
		input: emptySchema,
		output: pauseResultSchema,
	}),
	resume: planWrite({
		path: "/budget/resume",
		operationId: "resumeBudget",
		summary: "Bring the budget back after Just track",
		event: "budget_book.resumed",
		input: emptySchema,
		output: pauseResultSchema,
	}),
	createRule: planWrite({
		path: "/budget/rules",
		operationId: "createBudgetRule",
		summary: "Add an income rule",
		event: "budget_rule.created",
		input: createRuleInputSchema,
		output: incomeRuleSchema,
		status: 201,
	}),
	updateRule: planWrite({
		method: "PATCH",
		path: "/budget/rules/{id}",
		operationId: "updateBudgetRule",
		summary: "Change an income rule",
		event: "budget_rule.updated",
		input: updateRuleInputSchema,
		output: incomeRuleSchema,
	}),
	reorderRules: planWrite({
		path: "/budget/rules/reorder",
		operationId: "reorderBudgetRules",
		summary: "Set the order rules run in",
		event: "budget_rule.reordered",
		input: reorderRulesInputSchema,
		output: z.array(incomeRuleSchema),
	}),
	archiveRule: planWrite({
		method: "DELETE",
		path: "/budget/rules/{id}",
		operationId: "archiveBudgetRule",
		summary: "Archive an income rule",
		event: "budget_rule.archived",
		input: ruleIdInputSchema,
		output: incomeRuleSchema,
	}),
	saveDraft: planWrite({
		path: "/budget/drafts",
		operationId: "saveBudgetDraft",
		summary: "Save the open draft of a plan or What if",
		description: "A client id makes a retry a no-op.",
		event: "budget_draft.saved",
		input: saveDraftInputSchema,
		output: draftSchema,
	}),
	discardDraft: planWrite({
		path: "/budget/drafts/{draftId}/discard",
		operationId: "discardBudgetDraft",
		summary: "Discard a draft",
		event: "budget_draft.discarded",
		input: draftIdInputSchema,
		output: draftSchema,
	}),
	dismissMigrationNotice: planWrite({
		path: "/budget/migration/dismiss",
		operationId: "dismissBudgetMigrationNotice",
		summary: "Got it, on the notice that limits moved to the new budget",
		event: "budget_migration.notice_dismissed",
		input: emptySchema,
		output: migrationStateSchema,
	}),
};

const transferRemovedSchema = z.object({
	id: idSchema,
	accounts: z.array(accountChangeSchema),
});

/**
 * What an undo token reverted. `kind` names the inverse the token carried;
 * `result` is that inverse's own answer.
 */
export const budgetUndoResultSchema = z
	.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("movement.undo"),
			result: movementResultSchema,
		}),
		z.object({
			kind: z.literal("change.undo"),
			result: undoChangeResultSchema,
		}),
		z.object({
			kind: z.literal("limit.revert"),
			result: revertLimitResultSchema,
		}),
		z.object({
			kind: z.literal("style.revert"),
			result: revertStyleResultSchema,
		}),
		z.object({
			kind: z.literal("adjustment.remove"),
			result: adjustmentSchema,
		}),
		z.object({
			kind: z.literal("share_category.set"),
			result: shareCategoryResultSchema,
		}),
		z.object({
			kind: z.literal("project_routing.set"),
			result: projectRoutingResultSchema,
		}),
		z.object({
			kind: z.literal("forgive.undo"),
			result: z.object({ paymentId: idSchema }),
		}),
		z.object({ kind: z.literal("period.set"), result: bookPeriodResultSchema }),
		z.object({
			kind: z.literal("group_target.set"),
			result: groupTargetResultSchema,
		}),
		z.object({
			kind: z.literal("debt_terms.set"),
			result: debtTermsResultSchema,
		}),
		z.object({
			kind: z.literal("payoff_plan.revert"),
			result: payoffPlanResultSchema,
		}),
		z.object({ kind: z.literal("draft.unapply"), result: draftResultSchema }),
		z.object({
			kind: z.literal("hidden_rows.revert"),
			result: resolveHiddenResultSchema,
		}),
		z.object({
			kind: z.literal("debt_payment.delete"),
			result: transferRemovedSchema,
		}),
	])
	.meta({ id: "BudgetUndoResult" });

export const budgetUndo = {
	undo: v1
		.route({
			method: "POST",
			path: "/budget/undo",
			operationId: "undoBudgetWrite",
			tags: TAG,
			summary: "Revert a budget write from its undo token",
			description:
				"Each token works once, for 24 hours. A token whose row changed since the write answers 409.",
		})
		.meta({ scope: "write:money", event: "budget.undone" })
		.input(undoInputSchema)
		.output(
			z.object({
				result: budgetUndoResultSchema,
				redo: undoTokenSchema.nullable(),
			}),
		),
	previewUndo: previewTwin({
		path: "/budget/undo",
		of: "POST /budget/undo",
		operationId: "previewUndoBudgetWrite",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
