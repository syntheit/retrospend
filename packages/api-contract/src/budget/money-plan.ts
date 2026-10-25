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
import { debtPaymentResultSchema, recordDebtPaymentInputSchema } from "./debt";
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
});

export const budgetMoneyPlan = {
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
