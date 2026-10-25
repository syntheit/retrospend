import * as z from "zod";
import { idSchema } from "../core";
import {
	adjustmentSchema,
	bookPeriodResultSchema,
	reconcileInputSchema,
	removeAdjustmentInputSchema,
	revertLimitInputSchema,
	revertLimitResultSchema,
	revertStyleInputSchema,
	revertStyleResultSchema,
	setBookPeriodInputSchema,
	setLimitInputSchema,
	setLimitResultSchema,
	setStyleInputSchema,
	setStyleResultSchema,
	welcomeBackInputSchema,
	welcomeBackResultSchema,
} from "./book-write";
import {
	assignInputSchema,
	coverInputSchema,
	moveInputSchema,
	undoInputSchema as movementUndoInputSchema,
	setupInputSchema,
} from "./inputs";
import { movementResultSchema } from "./read";
import { moneyWrite } from "./routes";
import {
	batchInputSchema,
	carryOverspendInputSchema,
	forgiveInputSchema,
	forgiveResultSchema,
	projectRoutingResultSchema,
	setProjectRoutingInputSchema,
	setShareCategoryInputSchema,
	setupResultSchema,
	shareCategoryResultSchema,
	unforgiveInputSchema,
} from "./writes";

/** Assign, move and cover money, close a month, split shares, set up, styles, Limits and the bank check. */

const unforgiveResultSchema = z.object({ paymentId: idSchema });

const assign = moneyWrite({
	path: "/budget/assign",
	operationId: "assignBudgetMoney",
	previewId: "previewAssignBudgetMoney",
	summary: "Assign money to envelopes",
	event: "budget_movement.assigned",
	input: assignInputSchema,
	result: movementResultSchema,
});
const move = moneyWrite({
	path: "/budget/move",
	operationId: "moveBudgetMoney",
	previewId: "previewMoveBudgetMoney",
	summary: "Move money between envelopes or To assign",
	event: "budget_movement.moved",
	input: moveInputSchema,
	result: movementResultSchema,
});
const cover = moneyWrite({
	path: "/budget/cover",
	operationId: "coverBudgetEnvelope",
	previewId: "previewCoverBudgetEnvelope",
	summary: "Cover an overspent envelope",
	event: "budget_movement.covered",
	input: coverInputSchema,
	result: movementResultSchema,
});
const undoMovement = moneyWrite({
	path: "/budget/movements/undo",
	operationId: "undoBudgetMovement",
	previewId: "previewUndoBudgetMovement",
	summary: "Undo a movement or a batch from History",
	event: "budget_movement.undone",
	input: movementUndoInputSchema,
	result: movementResultSchema,
});
const carry = moneyWrite({
	path: "/budget/carry-overspend",
	operationId: "carryBudgetOverspend",
	previewId: "previewCarryBudgetOverspend",
	summary: "Take last month's overspend from this month",
	event: "budget_month.overspend_carried",
	input: carryOverspendInputSchema,
	result: movementResultSchema,
});
const fixNegative = moneyWrite({
	path: "/budget/fix-negative",
	operationId: "fixBudgetNegative",
	previewId: "previewFixBudgetNegative",
	summary: "Fix a negative To assign",
	event: "budget_month.negatives_fixed",
	input: batchInputSchema,
	result: movementResultSchema,
});
const reset = moneyWrite({
	path: "/budget/reset",
	operationId: "resetBudgetEnvelopes",
	previewId: "previewResetBudgetEnvelopes",
	summary: "Start fresh: take every envelope's money back",
	event: "budget_month.reset",
	input: batchInputSchema,
	result: movementResultSchema,
});

const setShareCategory = moneyWrite({
	path: "/budget/share-category",
	operationId: "setBudgetShareCategory",
	previewId: "previewSetBudgetShareCategory",
	summary: "Pick the category a split share counts in",
	event: "budget_share.category_set",
	input: setShareCategoryInputSchema,
	result: shareCategoryResultSchema,
});
const setProjectRouting = moneyWrite({
	path: "/budget/project-routing",
	operationId: "setBudgetProjectRouting",
	previewId: "previewSetBudgetProjectRouting",
	summary: "Choose how a project's shares count in the budget",
	event: "budget_project.routing_set",
	input: setProjectRoutingInputSchema,
	result: projectRoutingResultSchema,
});
const forgive = moneyWrite({
	path: "/budget/forgive",
	operationId: "forgiveBudgetDebt",
	previewId: "previewForgiveBudgetDebt",
	summary: "Forgive what someone owes you",
	event: "budget_owed.forgiven",
	input: forgiveInputSchema,
	result: forgiveResultSchema,
});
const unforgive = moneyWrite({
	path: "/budget/unforgive",
	operationId: "unforgiveBudgetDebt",
	previewId: "previewUnforgiveBudgetDebt",
	summary: "Take a forgiven amount back",
	event: "budget_owed.unforgiven",
	input: unforgiveInputSchema,
	result: unforgiveResultSchema,
});

const setup = moneyWrite({
	path: "/budget/setup",
	operationId: "setUpBudget",
	previewId: "previewSetUpBudget",
	summary: "Start the budget",
	event: "budget_book.set_up",
	input: setupInputSchema,
	result: setupResultSchema,
	status: 201,
});
const setStyle = moneyWrite({
	path: "/budget/style",
	operationId: "setBudgetStyle",
	previewId: "previewSetBudgetStyle",
	summary: "Switch the budget style",
	event: "budget_style.set",
	input: setStyleInputSchema,
	result: setStyleResultSchema,
});
const revertStyle = moneyWrite({
	path: "/budget/style/revert",
	operationId: "revertBudgetStyle",
	previewId: "previewRevertBudgetStyle",
	summary: "Undo the last style switch",
	event: "budget_style.reverted",
	input: revertStyleInputSchema,
	result: revertStyleResultSchema,
});
const setLimit = moneyWrite({
	path: "/budget/limits",
	operationId: "setBudgetLimit",
	previewId: "previewSetBudgetLimit",
	summary: "Change an envelope's limit",
	event: "budget_limit.set",
	input: setLimitInputSchema,
	result: setLimitResultSchema,
});
const revertLimit = moneyWrite({
	path: "/budget/limits/revert",
	operationId: "revertBudgetLimit",
	previewId: "previewRevertBudgetLimit",
	summary: "Undo an envelope's last limit change",
	event: "budget_limit.reverted",
	input: revertLimitInputSchema,
	result: revertLimitResultSchema,
});
const setPeriod = moneyWrite({
	path: "/budget/period",
	operationId: "setBudgetPeriod",
	previewId: "previewSetBudgetPeriod",
	summary: "Change the day a budget month starts or its rate type",
	event: "budget_book.period_set",
	input: setBookPeriodInputSchema,
	result: bookPeriodResultSchema,
});
const welcomeBack = moneyWrite({
	path: "/budget/welcome-back",
	operationId: "answerBudgetWelcomeBack",
	previewId: "previewAnswerBudgetWelcomeBack",
	summary: "Answer Welcome back: catch up, set what I have now or start fresh",
	event: "budget_book.welcomed_back",
	input: welcomeBackInputSchema,
	result: welcomeBackResultSchema,
});
const reconcile = moneyWrite({
	path: "/budget/reconcile",
	operationId: "reconcileBudget",
	previewId: "previewReconcileBudget",
	summary: "Record the difference from your bank as an Adjustment",
	event: "budget_book.reconciled",
	input: reconcileInputSchema,
	result: adjustmentSchema,
});
const removeAdjustment = moneyWrite({
	method: "DELETE",
	path: "/budget/adjustments/{expenseId}",
	operationId: "removeBudgetAdjustment",
	previewId: "previewRemoveBudgetAdjustment",
	summary: "Remove an Adjustment",
	event: "budget_book.adjustment_removed",
	input: removeAdjustmentInputSchema,
	result: adjustmentSchema,
});

export const budgetMoneyBook = {
	assign: assign.write,
	previewAssign: assign.preview,
	move: move.write,
	previewMove: move.preview,
	cover: cover.write,
	previewCover: cover.preview,
	undoMovement: undoMovement.write,
	previewUndoMovement: undoMovement.preview,
	carryOverspend: carry.write,
	previewCarryOverspend: carry.preview,
	fixNegative: fixNegative.write,
	previewFixNegative: fixNegative.preview,
	reset: reset.write,
	previewReset: reset.preview,
	setShareCategory: setShareCategory.write,
	previewSetShareCategory: setShareCategory.preview,
	setProjectRouting: setProjectRouting.write,
	previewSetProjectRouting: setProjectRouting.preview,
	forgive: forgive.write,
	previewForgive: forgive.preview,
	unforgive: unforgive.write,
	previewUnforgive: unforgive.preview,
	setup: setup.write,
	previewSetup: setup.preview,
	setStyle: setStyle.write,
	previewSetStyle: setStyle.preview,
	revertStyle: revertStyle.write,
	previewRevertStyle: revertStyle.preview,
	setLimit: setLimit.write,
	previewSetLimit: setLimit.preview,
	revertLimit: revertLimit.write,
	previewRevertLimit: revertLimit.preview,
	setPeriod: setPeriod.write,
	previewSetPeriod: setPeriod.preview,
	welcomeBack: welcomeBack.write,
	previewWelcomeBack: welcomeBack.preview,
	reconcile: reconcile.write,
	previewReconcile: reconcile.preview,
	removeAdjustment: removeAdjustment.write,
	previewRemoveAdjustment: removeAdjustment.preview,
};
