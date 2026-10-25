import { budgetOps as ops } from "~/server/services/api-v1/budget/ops";
import {
	previewUndoBudgetWrite,
	undoBudgetWrite,
} from "~/server/services/api-v1/budget/undo";
import type { MoneyOp } from "~/server/services/api-v1/budget/write";
import { v1 } from "../middleware";
import { budgetHandler as h } from "./handler";

const b = v1.budget;

const write = <I, V>(op: MoneyOp<I, V>) =>
	h((caller, input: I) => op.write(caller, input));
const preview = <I, V>(op: MoneyOp<I, V>) =>
	h((caller, input: I) => op.preview(caller, input));

/** The budget's money writes, each with its preview twin. */
export const budgetMoneyRouter = {
	assign: b.assign.handler(write(ops.assign)),
	previewAssign: b.previewAssign.handler(preview(ops.assign)),
	move: b.move.handler(write(ops.move)),
	previewMove: b.previewMove.handler(preview(ops.move)),
	cover: b.cover.handler(write(ops.cover)),
	previewCover: b.previewCover.handler(preview(ops.cover)),
	undoMovement: b.undoMovement.handler(write(ops.undoMovement)),
	previewUndoMovement: b.previewUndoMovement.handler(preview(ops.undoMovement)),
	carryOverspend: b.carryOverspend.handler(write(ops.carryOverspend)),
	previewCarryOverspend: b.previewCarryOverspend.handler(
		preview(ops.carryOverspend),
	),
	fixNegative: b.fixNegative.handler(write(ops.fixNegative)),
	previewFixNegative: b.previewFixNegative.handler(preview(ops.fixNegative)),
	reset: b.reset.handler(write(ops.reset)),
	previewReset: b.previewReset.handler(preview(ops.reset)),
	setShareCategory: b.setShareCategory.handler(write(ops.setShareCategory)),
	previewSetShareCategory: b.previewSetShareCategory.handler(
		preview(ops.setShareCategory),
	),
	setProjectRouting: b.setProjectRouting.handler(write(ops.setProjectRouting)),
	previewSetProjectRouting: b.previewSetProjectRouting.handler(
		preview(ops.setProjectRouting),
	),
	forgive: b.forgive.handler(write(ops.forgive)),
	previewForgive: b.previewForgive.handler(preview(ops.forgive)),
	unforgive: b.unforgive.handler(write(ops.unforgive)),
	previewUnforgive: b.previewUnforgive.handler(preview(ops.unforgive)),
	setup: b.setup.handler(write(ops.setup)),
	previewSetup: b.previewSetup.handler(preview(ops.setup)),
	setStyle: b.setStyle.handler(write(ops.setStyle)),
	previewSetStyle: b.previewSetStyle.handler(preview(ops.setStyle)),
	revertStyle: b.revertStyle.handler(write(ops.revertStyle)),
	previewRevertStyle: b.previewRevertStyle.handler(preview(ops.revertStyle)),
	setLimit: b.setLimit.handler(write(ops.setLimit)),
	previewSetLimit: b.previewSetLimit.handler(preview(ops.setLimit)),
	revertLimit: b.revertLimit.handler(write(ops.revertLimit)),
	previewRevertLimit: b.previewRevertLimit.handler(preview(ops.revertLimit)),
	setPeriod: b.setPeriod.handler(write(ops.setPeriod)),
	previewSetPeriod: b.previewSetPeriod.handler(preview(ops.setPeriod)),
	welcomeBack: b.welcomeBack.handler(write(ops.welcomeBack)),
	previewWelcomeBack: b.previewWelcomeBack.handler(preview(ops.welcomeBack)),
	reconcile: b.reconcile.handler(write(ops.reconcile)),
	previewReconcile: b.previewReconcile.handler(preview(ops.reconcile)),
	removeAdjustment: b.removeAdjustment.handler(write(ops.removeAdjustment)),
	previewRemoveAdjustment: b.previewRemoveAdjustment.handler(
		preview(ops.removeAdjustment),
	),
	setTarget: b.setTarget.handler(write(ops.setTarget)),
	previewSetTarget: b.previewSetTarget.handler(preview(ops.setTarget)),
	createEnvelope: b.createEnvelope.handler(write(ops.createEnvelope)),
	previewCreateEnvelope: b.previewCreateEnvelope.handler(
		preview(ops.createEnvelope),
	),
	updateEnvelope: b.updateEnvelope.handler(write(ops.updateEnvelope)),
	previewUpdateEnvelope: b.previewUpdateEnvelope.handler(
		preview(ops.updateEnvelope),
	),
	mergeEnvelopes: b.mergeEnvelopes.handler(write(ops.mergeEnvelopes)),
	previewMergeEnvelopes: b.previewMergeEnvelopes.handler(
		preview(ops.mergeEnvelopes),
	),
	archiveEnvelope: b.archiveEnvelope.handler(write(ops.archiveEnvelope)),
	previewArchiveEnvelope: b.previewArchiveEnvelope.handler(
		preview(ops.archiveEnvelope),
	),
	confirmStartingMoney: b.confirmStartingMoney.handler(
		write(ops.confirmStartingMoney),
	),
	previewConfirmStartingMoney: b.previewConfirmStartingMoney.handler(
		preview(ops.confirmStartingMoney),
	),
	undoChange: b.undoChange.handler(write(ops.undoChange)),
	previewUndoChange: b.previewUndoChange.handler(preview(ops.undoChange)),
	applyRule: b.applyRule.handler(write(ops.applyRule)),
	previewApplyRule: b.previewApplyRule.handler(preview(ops.applyRule)),
	applyDraft: b.applyDraft.handler(write(ops.applyDraft)),
	previewApplyDraft: b.previewApplyDraft.handler(preview(ops.applyDraft)),
	unapplyDraft: b.unapplyDraft.handler(write(ops.unapplyDraft)),
	previewUnapplyDraft: b.previewUnapplyDraft.handler(preview(ops.unapplyDraft)),
	fundPlanNow: b.fundPlanNow.handler(write(ops.fundPlanNow)),
	previewFundPlanNow: b.previewFundPlanNow.handler(preview(ops.fundPlanNow)),
	usePlan: b.usePlan.handler(write(ops.usePlan)),
	previewUsePlan: b.previewUsePlan.handler(preview(ops.usePlan)),
	recordDebtPayment: b.recordDebtPayment.handler(write(ops.recordDebtPayment)),
	previewRecordDebtPayment: b.previewRecordDebtPayment.handler(
		preview(ops.recordDebtPayment),
	),
	resolveHidden: b.resolveHidden.handler(write(ops.resolveHidden)),
	previewResolveHidden: b.previewResolveHidden.handler(
		preview(ops.resolveHidden),
	),
	revertHidden: b.revertHidden.handler(write(ops.revertHidden)),
	previewRevertHidden: b.previewRevertHidden.handler(preview(ops.revertHidden)),
	setGroupTarget: b.setGroupTarget.handler(write(ops.setGroupTarget)),
	previewSetGroupTarget: b.previewSetGroupTarget.handler(
		preview(ops.setGroupTarget),
	),
	setDebtTerms: b.setDebtTerms.handler(write(ops.setDebtTerms)),
	previewSetDebtTerms: b.previewSetDebtTerms.handler(preview(ops.setDebtTerms)),
	savePayoffPlan: b.savePayoffPlan.handler(write(ops.savePayoffPlan)),
	previewSavePayoffPlan: b.previewSavePayoffPlan.handler(
		preview(ops.savePayoffPlan),
	),
	revertPayoffPlan: b.revertPayoffPlan.handler(write(ops.revertPayoffPlan)),
	previewRevertPayoffPlan: b.previewRevertPayoffPlan.handler(
		preview(ops.revertPayoffPlan),
	),
	undo: b.undo.handler(
		h((caller, input: { token: string }) =>
			undoBudgetWrite(caller, input.token),
		),
	),
	previewUndo: b.previewUndo.handler(
		h((caller, input: { token: string }) =>
			previewUndoBudgetWrite(caller, input.token),
		),
	),
};
