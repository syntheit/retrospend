import * as z from "zod";
import {
	archiveEnvelopeInputSchema,
	archiveEnvelopeResultSchema,
	confirmStartingMoneyInputSchema,
	confirmStartingMoneyResultSchema,
	createEnvelopeInputSchema,
	createEnvelopeResultSchema,
	mergeEnvelopesInputSchema,
	mergeEnvelopesResultSchema,
	setTargetInputSchema,
	setTargetResultSchema,
	undoChangeInputSchema,
	undoChangeResultSchema,
	updateEnvelopeInputSchema,
	updateEnvelopeResultSchema,
} from "./crud-edits";
import {
	debtPaymentResultSchema,
	debtTermsResultSchema,
	payoffPlanResultSchema,
	recordDebtPaymentInputSchema,
	savePayoffPlanInputSchema,
	setDebtTermsInputSchema,
} from "./debt";
import {
	resolveHiddenInputSchema,
	resolveHiddenResultSchema,
	revertHiddenInputSchema,
} from "./migration";
import {
	applyDraftInputSchema,
	draftIdInputSchema,
	draftResultSchema,
	fundNowInputSchema,
} from "./plan-drafts";
import {
	applyRuleResultSchema,
	applyRuleToMonthInputSchema,
} from "./plan-rules";
import {
	groupTargetResultSchema,
	setGroupTargetInputSchema,
} from "./plan-year";
import { moneyWrite } from "./routes";

/** Envelope edits, rules and drafts that move money, Pay down a debt and the hidden-rows review. */

const setTarget = moneyWrite({
	path: "/budget/envelopes/{envelopeId}/target",
	operationId: "setBudgetEnvelopeTarget",
	previewId: "previewSetBudgetEnvelopeTarget",
	summary: "Set an envelope's target",
	event: "budget_envelope.target_set",
	input: setTargetInputSchema,
	result: setTargetResultSchema,
});
const create = moneyWrite({
	path: "/budget/envelopes",
	operationId: "createBudgetEnvelope",
	previewId: "previewCreateBudgetEnvelope",
	summary: "Create an envelope",
	event: "budget_envelope.created",
	input: createEnvelopeInputSchema,
	result: createEnvelopeResultSchema,
	status: 201,
});
const update = moneyWrite({
	method: "PATCH",
	path: "/budget/envelopes/{envelopeId}",
	operationId: "updateBudgetEnvelope",
	previewId: "previewUpdateBudgetEnvelope",
	summary: "Rename an envelope, move it to a group or change its categories",
	event: "budget_envelope.updated",
	input: updateEnvelopeInputSchema,
	result: updateEnvelopeResultSchema,
});
const merge = moneyWrite({
	path: "/budget/merge-envelopes",
	operationId: "mergeBudgetEnvelopes",
	previewId: "previewMergeBudgetEnvelopes",
	summary: "Combine envelopes into one",
	event: "budget_envelope.merged",
	input: mergeEnvelopesInputSchema,
	result: mergeEnvelopesResultSchema,
});
const archive = moneyWrite({
	path: "/budget/envelopes/{envelopeId}/archive",
	operationId: "archiveBudgetEnvelope",
	previewId: "previewArchiveBudgetEnvelope",
	summary: "Archive an envelope",
	event: "budget_envelope.archived",
	input: archiveEnvelopeInputSchema,
	result: archiveEnvelopeResultSchema,
});
const startingMoney = moneyWrite({
	path: "/budget/starting-money",
	operationId: "confirmBudgetStartingMoney",
	previewId: "previewConfirmBudgetStartingMoney",
	summary: "Say how much you have right now",
	event: "budget_book.starting_money_confirmed",
	input: confirmStartingMoneyInputSchema,
	result: confirmStartingMoneyResultSchema,
});
const undoChange = moneyWrite({
	path: "/budget/changes/{id}/undo",
	operationId: "undoBudgetChange",
	previewId: "previewUndoBudgetChange",
	summary: "Undo the newest edit of an envelope",
	event: "budget_envelope.change_undone",
	input: undoChangeInputSchema,
	result: undoChangeResultSchema,
	noUndo: "an undo is not undone; make the edit again.",
});

const applyRule = moneyWrite({
	path: "/budget/rules/{ruleId}/apply",
	operationId: "applyBudgetRule",
	previewId: "previewApplyBudgetRule",
	summary: "Also apply a rule to this month's money in",
	event: "budget_rule.applied",
	input: applyRuleToMonthInputSchema,
	result: applyRuleResultSchema,
});
const applyDraft = moneyWrite({
	path: "/budget/drafts/{draftId}/apply",
	operationId: "applyBudgetDraft",
	previewId: "previewApplyBudgetDraft",
	summary: "Apply a draft: save a plan, or write What if's moves",
	event: "budget_draft.applied",
	input: applyDraftInputSchema,
	result: draftResultSchema,
});
const unapplyDraft = moneyWrite({
	path: "/budget/drafts/{draftId}/unapply",
	operationId: "unapplyBudgetDraft",
	previewId: "previewUnapplyBudgetDraft",
	summary: "Take an applied plan back",
	event: "budget_draft.unapplied",
	input: draftIdInputSchema,
	result: draftResultSchema,
	noUndo: "an undo is not undone; apply the plan again.",
});
const fundNow = moneyWrite({
	path: "/budget/drafts/{draftId}/fund-now",
	operationId: "fundBudgetPlanNow",
	previewId: "previewFundBudgetPlanNow",
	summary: "Fund a plan now from what you have",
	event: "budget_draft.funded",
	input: fundNowInputSchema,
	result: draftResultSchema,
});

const debtPayment = moneyWrite({
	path: "/budget/debt-payments",
	operationId: "recordBudgetDebtPayment",
	previewId: "previewRecordBudgetDebtPayment",
	summary: "Pay down a debt",
	event: "budget_debt.payment_recorded",
	input: recordDebtPaymentInputSchema,
	result: debtPaymentResultSchema,
	status: 201,
});

const resolveHidden = moneyWrite({
	path: "/budget/hidden-rows/resolve",
	operationId: "resolveBudgetHiddenRows",
	previewId: "previewResolveBudgetHiddenRows",
	summary: "Answer the hidden-rows review",
	event: "budget_hidden_rows.resolved",
	input: resolveHiddenInputSchema,
	result: resolveHiddenResultSchema,
});
const revertHidden = moneyWrite({
	path: "/budget/hidden-rows/revert",
	operationId: "revertBudgetHiddenRows",
	previewId: "previewRevertBudgetHiddenRows",
	summary: "Take hidden-rows answers back",
	event: "budget_hidden_rows.reverted",
	input: revertHiddenInputSchema,
	result: resolveHiddenResultSchema,
	noUndo: "an undo is not undone; answer the rows again.",
});

/**
 * Group targets, debt terms and the payoff plan move no money themselves, but
 * they change what Use my plan asks of each month (and the payoff plan sets
 * an envelope's target), so each previews and has an undo like Set a target.
 */
const groupTarget = moneyWrite({
	method: "PUT",
	path: "/budget/groups/{groupId}/target",
	operationId: "setBudgetGroupTarget",
	previewId: "previewSetBudgetGroupTarget",
	summary: "Set a group's target",
	event: "budget_group.target_set",
	input: setGroupTargetInputSchema,
	result: groupTargetResultSchema,
});
const debtTerms = moneyWrite({
	method: "PUT",
	path: "/budget/debts/{assetAccountId}/terms",
	operationId: "setBudgetDebtTerms",
	previewId: "previewSetBudgetDebtTerms",
	summary: "Set a debt's rate, minimum and due day",
	event: "budget_debt.terms_set",
	input: setDebtTermsInputSchema,
	result: debtTermsResultSchema,
});
const savePayoff = moneyWrite({
	method: "PUT",
	path: "/budget/payoff-plan",
	operationId: "saveBudgetPayoffPlan",
	previewId: "previewSaveBudgetPayoffPlan",
	summary: "Save the debt payoff plan",
	event: "budget_payoff_plan.saved",
	input: savePayoffPlanInputSchema,
	result: payoffPlanResultSchema,
});
const revertPayoff = moneyWrite({
	path: "/budget/payoff-plan/revert",
	operationId: "revertBudgetPayoffPlan",
	previewId: "previewRevertBudgetPayoffPlan",
	summary: "Put the payoff plan back as it was before the last save",
	event: "budget_payoff_plan.reverted",
	input: z.object({}),
	result: payoffPlanResultSchema,
	noUndo: "an undo is not undone; save the plan again.",
});

export const budgetMoneyPlan = {
	setGroupTarget: groupTarget.write,
	previewSetGroupTarget: groupTarget.preview,
	setDebtTerms: debtTerms.write,
	previewSetDebtTerms: debtTerms.preview,
	savePayoffPlan: savePayoff.write,
	previewSavePayoffPlan: savePayoff.preview,
	revertPayoffPlan: revertPayoff.write,
	previewRevertPayoffPlan: revertPayoff.preview,
	setTarget: setTarget.write,
	previewSetTarget: setTarget.preview,
	createEnvelope: create.write,
	previewCreateEnvelope: create.preview,
	updateEnvelope: update.write,
	previewUpdateEnvelope: update.preview,
	mergeEnvelopes: merge.write,
	previewMergeEnvelopes: merge.preview,
	archiveEnvelope: archive.write,
	previewArchiveEnvelope: archive.preview,
	confirmStartingMoney: startingMoney.write,
	previewConfirmStartingMoney: startingMoney.preview,
	undoChange: undoChange.write,
	previewUndoChange: undoChange.preview,
	applyRule: applyRule.write,
	previewApplyRule: applyRule.preview,
	applyDraft: applyDraft.write,
	previewApplyDraft: applyDraft.preview,
	unapplyDraft: unapplyDraft.write,
	previewUnapplyDraft: unapplyDraft.preview,
	fundPlanNow: fundNow.write,
	previewFundPlanNow: fundNow.preview,
	recordDebtPayment: debtPayment.write,
	previewRecordDebtPayment: debtPayment.preview,
	resolveHidden: resolveHidden.write,
	previewResolveHidden: resolveHidden.preview,
	revertHidden: revertHidden.write,
	previewRevertHidden: revertHidden.preview,
};
