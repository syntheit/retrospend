import { randomUUID } from "node:crypto";
import type { SetupInput } from "~/lib/schemas/envelope";
import {
	reconcileMutation,
	removeAdjustmentMutation,
	revertLimitMutation,
	revertStyleMutation,
	setBookPeriodMutation,
	setLimitMutation,
	setStyleMutation,
	welcomeBackMutation,
} from "~/server/services/envelope/book.mutation";
import {
	carryOverspendMutation,
	fixNegativeMutation,
	resetEnvelopesMutation,
} from "~/server/services/envelope/close.mutation";
import {
	archiveEnvelopeMutation,
	confirmStartingMoneyMutation,
	createEnvelopeMutation,
	mergeEnvelopesMutation,
	setTargetMutation,
	undoChangeMutation,
	updateEnvelopeMutation,
} from "~/server/services/envelope/crud.mutation";
import { recordDebtPaymentMutation } from "~/server/services/envelope/debt.mutation";
import {
	resolveHiddenMutation,
	revertHiddenMutation,
} from "~/server/services/envelope/migration.mutation";
import {
	assignEnvelopes,
	coverEnvelope,
	moveMoney,
	undoMovements,
} from "~/server/services/envelope/movement.mutation";
import {
	applyDraftMutation,
	applyRuleToMonthMutation,
	fundPlanNowMutation,
	unapplyDraftMutation,
} from "~/server/services/envelope/plan.mutation";
import {
	type SetupMutationInput,
	setupEnvelopeBook,
} from "~/server/services/envelope/setup.mutation";
import {
	forgiveMutation,
	setProjectRoutingMutation,
	setShareCategoryMutation,
	unforgiveMutation,
} from "~/server/services/envelope/splits.mutation";
import { adjustmentPlan, changePlan, movementPlan } from "./plans";
import { moneyOp } from "./write";

/**
 * Every budget money write: the web's mutation and how to take it back. The
 * routes are one line each; the mutation is the one the tRPC procedure runs.
 */

export const budgetOps = {
	assign: moneyOp(assignEnvelopes, { plan: (_i, v) => movementPlan(v) }),
	move: moneyOp(moveMoney, { plan: (_i, v) => movementPlan(v) }),
	cover: moneyOp(coverEnvelope, { plan: (_i, v) => movementPlan(v) }),
	undoMovement: moneyOp(undoMovements),
	carryOverspend: moneyOp(carryOverspendMutation, {
		plan: (_i, v) => movementPlan(v),
	}),
	fixNegative: moneyOp(fixNegativeMutation, {
		plan: (_i, v) => movementPlan(v),
	}),
	reset: moneyOp(resetEnvelopesMutation, { plan: (_i, v) => movementPlan(v) }),

	setShareCategory: moneyOp(setShareCategoryMutation, {
		plan: (i, v) => ({
			op: "share_category.set",
			args: {
				transactionId: i.transactionId,
				categoryId: v.previous.categoryId,
				source: v.previous.source ?? "USER",
			},
			guard: { table: "splitParticipant", id: v.shareId },
		}),
	}),
	setProjectRouting: moneyOp(setProjectRoutingMutation, {
		plan: (i, v) => ({
			op: "project_routing.set",
			args: {
				projectId: i.projectId,
				routing: v.previous.routing,
				envelopeId: v.previous.envelopeId,
			},
			guard: { table: "projectParticipant", id: v.participantId },
		}),
	}),
	forgive: moneyOp(forgiveMutation, {
		plan: (_i, v) => ({
			op: "forgive.undo",
			args: { paymentId: v.paymentId },
			guard: { table: "payment", id: v.paymentId },
		}),
	}),
	unforgive: moneyOp(unforgiveMutation),

	setup: moneyOp(setupEnvelopeBook, {
		prep: (caller, input: SetupInput): SetupMutationInput => ({
			...input,
			timeZone: caller.timeZone,
		}),
	}),
	setStyle: moneyOp(setStyleMutation, {
		plan: (_i, v) => ({
			op: "style.revert",
			args: {},
			guard: { table: "budgetBook", id: v.bookId },
		}),
	}),
	revertStyle: moneyOp(revertStyleMutation),
	setLimit: moneyOp(setLimitMutation, {
		plan: (i, v) =>
			i.scope === "FROM_NOW_ON"
				? {
						op: "limit.revert",
						args: { id: randomUUID(), envelopeId: v.envelopeId },
						guard: { table: "envelope", id: v.envelopeId },
					}
				: movementPlan(v),
	}),
	revertLimit: moneyOp(revertLimitMutation),
	setPeriod: moneyOp(setBookPeriodMutation, {
		plan: (_i, v) =>
			v.periodId === null
				? null
				: {
						op: "period.set",
						args: {
							startDay: v.previous.startDay,
							rateType: v.previous.rateType,
						},
						guard: { table: "bookPeriod" },
					},
	}),
	welcomeBack: moneyOp(welcomeBackMutation, {
		plan: (_i, v) =>
			v.choice === "SET_HAVE_NOW"
				? adjustmentPlan(v.adjustment?.expenseId ?? null)
				: v.choice === "START_FRESH"
					? movementPlan(v.movements)
					: null,
	}),
	reconcile: moneyOp(reconcileMutation, {
		plan: (_i, v) => adjustmentPlan(v.expenseId),
	}),
	removeAdjustment: moneyOp(removeAdjustmentMutation),

	setTarget: moneyOp(setTargetMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	createEnvelope: moneyOp(createEnvelopeMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	updateEnvelope: moneyOp(updateEnvelopeMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	mergeEnvelopes: moneyOp(mergeEnvelopesMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	archiveEnvelope: moneyOp(archiveEnvelopeMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	confirmStartingMoney: moneyOp(confirmStartingMoneyMutation, {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	undoChange: moneyOp(undoChangeMutation),

	applyRule: moneyOp(applyRuleToMonthMutation, {
		plan: (_i, v) => movementPlan(v.movement),
	}),
	applyDraft: moneyOp(applyDraftMutation, {
		plan: (_i, v) =>
			v.draft.kind === "PLAN"
				? {
						op: "draft.unapply",
						args: { draftId: v.draft.id },
						guard: { table: "budgetDraft", id: v.draft.id },
					}
				: movementPlan(v.movement),
	}),
	unapplyDraft: moneyOp(unapplyDraftMutation),
	fundPlanNow: moneyOp(fundPlanNowMutation, {
		plan: (_i, v) => movementPlan(v.movement),
	}),

	recordDebtPayment: moneyOp(recordDebtPaymentMutation, {
		plan: (_i, v) => ({
			op: "debt_payment.delete",
			args: { transferId: v.transferId },
		}),
	}),
	resolveHidden: moneyOp(resolveHiddenMutation, {
		plan: (_i, v) => {
			const ids = [...v.spending, ...v.notSpending];
			return ids.length === 0
				? null
				: {
						op: "hidden_rows.revert",
						args: { spending: v.spending, notSpending: v.notSpending },
						guard: { table: "expense", ids },
					};
		},
	}),
	revertHidden: moneyOp(revertHiddenMutation),
};
