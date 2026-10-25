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
import { usePlanMutation } from "~/server/services/envelope/use-plan.mutation";
import {
	draftResultOut,
	fromEngine,
	type Renamed,
	v1Mutation,
} from "./amounts";
import {
	revertPayoffPlanMutation,
	savePayoffPlanMutation,
	setDebtTermsMutation,
	setGroupTargetMutation,
} from "./plan-mutations";
import { adjustmentPlan, changePlan, movementPlan } from "./plans";
import { moneyOp } from "./write";

/**
 * Every budget money write: the web's mutation and how to take it back. The
 * routes are one line each; the mutation is the one the tRPC procedure runs.
 */

export const budgetOps = {
	assign: moneyOp(v1Mutation(assignEnvelopes), {
		plan: (_i, v) => movementPlan(v),
	}),
	move: moneyOp(v1Mutation(moveMoney), { plan: (_i, v) => movementPlan(v) }),
	cover: moneyOp(v1Mutation(coverEnvelope), {
		plan: (_i, v) => movementPlan(v),
	}),
	undoMovement: moneyOp(undoMovements),
	carryOverspend: moneyOp(v1Mutation(carryOverspendMutation), {
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
	forgive: moneyOp(v1Mutation(forgiveMutation), {
		plan: (_i, v) => ({
			op: "forgive.undo",
			args: { paymentId: v.paymentId },
			guard: { table: "payment", id: v.paymentId },
		}),
	}),
	unforgive: moneyOp(unforgiveMutation),

	setup: moneyOp(v1Mutation(setupEnvelopeBook), {
		prep: (
			caller,
			input: Renamed<SetupInput>,
		): Renamed<SetupMutationInput> => ({
			...input,
			timeZone: caller.timeZone,
		}),
	}),
	setStyle: moneyOp(v1Mutation(setStyleMutation), {
		plan: (_i, v) => ({
			op: "style.revert",
			args: {},
			guard: { table: "budgetBook", id: v.bookId },
		}),
	}),
	revertStyle: moneyOp(revertStyleMutation),
	setLimit: moneyOp(v1Mutation(setLimitMutation), {
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
	welcomeBack: moneyOp(v1Mutation(welcomeBackMutation), {
		plan: (_i, v) =>
			v.choice === "SET_HAVE_NOW"
				? adjustmentPlan(v.adjustment?.expenseId ?? null)
				: v.choice === "START_FRESH"
					? movementPlan(v.movements)
					: null,
	}),
	reconcile: moneyOp(v1Mutation(reconcileMutation), {
		plan: (_i, v) => adjustmentPlan(v.expenseId),
	}),
	removeAdjustment: moneyOp(removeAdjustmentMutation),

	setTarget: moneyOp(v1Mutation(setTargetMutation), {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	createEnvelope: moneyOp(v1Mutation(createEnvelopeMutation), {
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
	confirmStartingMoney: moneyOp(v1Mutation(confirmStartingMoneyMutation), {
		plan: (_i, v) => changePlan(v.changeId),
	}),
	undoChange: moneyOp(undoChangeMutation),

	applyRule: moneyOp(applyRuleToMonthMutation, {
		plan: (_i, v) => movementPlan(v.movement),
	}),
	applyDraft: moneyOp(v1Mutation(applyDraftMutation, draftResultOut), {
		plan: (_i, v) =>
			v.draft.kind === "PLAN"
				? {
						op: "draft.unapply",
						args: { draftId: v.draft.id },
						guard: { table: "budgetDraft", id: v.draft.id },
					}
				: movementPlan(v.movement),
	}),
	unapplyDraft: moneyOp(v1Mutation(unapplyDraftMutation, draftResultOut)),
	fundPlanNow: moneyOp(v1Mutation(fundPlanNowMutation, draftResultOut), {
		plan: (_i, v) => movementPlan(v.movement),
	}),

	setGroupTarget: moneyOp(v1Mutation(setGroupTargetMutation, fromEngine), {
		plan: (i, v) => ({
			op: "group_target.set",
			args: {
				groupId: i.groupId,
				target: v.previous.target,
				mainEnvelopeId: v.previous.mainEnvelopeId,
			},
			guard: { table: "envelopeGroup", id: v.groupId },
		}),
	}),
	setDebtTerms: moneyOp(v1Mutation(setDebtTermsMutation), {
		plan: (i, v) => ({
			op: "debt_terms.set",
			args: {
				assetAccountId: i.assetAccountId,
				aprPercent: v.previous.aprPercent,
				minimumMinor: v.previous.minimum?.minor ?? null,
				dueDay: v.previous.dueDay,
			},
			guard: { table: "account", id: i.assetAccountId },
		}),
	}),
	savePayoffPlan: moneyOp(v1Mutation(savePayoffPlanMutation), {
		plan: () => ({
			op: "payoff_plan.revert",
			args: {},
			guard: { table: "payoffPlan" },
		}),
	}),
	revertPayoffPlan: moneyOp(v1Mutation(revertPayoffPlanMutation)),
	usePlan: moneyOp(v1Mutation(usePlanMutation), {
		plan: (_i, v) =>
			v.batchId && !v.replayed
				? {
						op: "movement.undo",
						args: {
							items: [{ id: randomUUID(), target: { batchId: v.batchId } }],
						},
					}
				: null,
	}),
	recordDebtPayment: moneyOp(v1Mutation(recordDebtPaymentMutation), {
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
