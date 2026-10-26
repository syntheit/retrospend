import type { EventType } from "@retrospend/api-contract";

/**
 * The event a money mutation appends when it runs outside a v1 route (the
 * web's tRPC procedures). Inside a v1 route the route's own event type wins
 * (see scope.ts), so both transports name an event the same way: an undo
 * names what the route's undo names (`correction.undone` for fix requests
 * and corrections, `shared_expense.undone` for a share answer).
 *
 * A mutation missing here appends nothing from tRPC;
 * mutation-events.test.ts fails for a new mutation that is not listed.
 * One mutation that does two things names its event from its result.
 */
type EventName = EventType | ((value: unknown) => EventType);

export const MUTATION_EVENTS: Readonly<Record<string, EventName>> = {
	"import.commit": "import.finalized",
	"import.undo": "import.undone",
	"recurring.confirm": "recurring.confirmed",
	"recurring.unconfirm": "recurring.undone",
	"income.add": "income.created",
	"income.delete": "income.deleted",
	"expense.create": "expense.created",
	"expense.update": "expense.updated",
	"expense.delete": "expense.deleted",
	"expense.restore": "expense.undone",
	"expense.categorize": "expenses.categorized",
	"sharedExpense.create": "shared_expense.created",
	"sharedExpense.update": "shared_expense.updated",
	"sharedExpense.delete": "shared_expense.deleted",
	"transfer.create": "transfer.created",
	"transfer.delete": "transfer.deleted",
	"payment.record": "payment.recorded",
	"payment.confirm": "payment.confirmed",
	"payment.unconfirm": "payment.undone",
	"payment.remove": "payment.undone",
	"payment.reject": "payment.not_received",
	"project.settleAll": "project.settled_all",
	"project.settleAllUndo": "project.settle_all_undone",
	"account.create": "account.created",
	"account.update": "account.updated",
	"account.delete": "account.deleted",
	"account.updateBalance": "account.balance_updated",
	"account.revertBalanceUpdate": "account.undone",
	"account.setRateType": "account.rate_type_set",
	"account.revertRateType": "account.undone",
	"envelope.assign": "budget_movement.assigned",
	"envelope.move": "budget_movement.moved",
	"envelope.cover": "budget_movement.covered",
	"envelope.undo": "budget_movement.undone",
	"envelope.undoChange": "budget_envelope.change_undone",
	"envelope.setTarget": "budget_envelope.target_set",
	"envelope.createEnvelope": "budget_envelope.created",
	"envelope.updateEnvelope": "budget_envelope.updated",
	"envelope.mergeEnvelopes": "budget_envelope.merged",
	"envelope.archiveEnvelope": "budget_envelope.archived",
	"envelope.confirmStartingMoney": "budget_book.starting_money_confirmed",
	"envelope.setLimit": "budget_limit.set",
	"envelope.revertLimit": "budget_limit.reverted",
	"envelope.setStyle": "budget_style.set",
	"envelope.revertStyle": "budget_style.reverted",
	"envelope.reconcile": "budget_book.reconciled",
	"envelope.removeAdjustment": "budget_book.adjustment_removed",
	"envelope.welcomeBack": "budget_book.welcomed_back",
	"envelope.setBookPeriod": "budget_book.period_set",
	"envelope.setup": "budget_book.set_up",
	"envelope.carryOverspend": "budget_month.overspend_carried",
	"envelope.fixNegative": "budget_month.negatives_fixed",
	"envelope.reset": "budget_month.reset",
	"envelope.setShareCategory": "budget_share.category_set",
	"envelope.setProjectRouting": "budget_project.routing_set",
	"envelope.forgive": "budget_owed.forgiven",
	"envelope.unforgive": "budget_owed.unforgiven",
	"envelope.usePlan": "budget_plan.used",
	"envelope.applyRuleToMonth": "budget_rule.applied",
	"envelope.applyDraft": "budget_draft.applied",
	"envelope.unapplyDraft": "budget_draft.unapplied",
	"envelope.fundPlanNow": "budget_draft.funded",
	"envelope.recordDebtPayment": "budget_debt.payment_recorded",
	"envelope.setGroupTarget": "budget_group.target_set",
	"envelope.setDebtTerms": "budget_debt.terms_set",
	"envelope.savePayoffPlan": "budget_payoff_plan.saved",
	"envelope.revertPayoffPlan": "budget_payoff_plan.reverted",
	"envelope.resolveHidden": "budget_hidden_rows.resolved",
	"envelope.revertHidden": "budget_hidden_rows.reverted",
	"income.moveIn": "income.moved_in",
	"income.undoMoveIn": "income.undone",
	"income.confirmRecurring": "recurring.confirmed",
	"income.unconfirmRecurring": "recurring.undone",
	"correction.apply": "shared_expense.corrected",
	"correction.undo": "correction.undone",
	"fixRequest.ask": "fix_request.created",
	"fixRequest.respond": "fix_request.answered",
	"fixRequest.cancel": "fix_request.cancelled",
	"fixRequest.withdraw": "correction.undone",
	"fixRequest.restore": "correction.undone",
	"project.membershipDates": "project.member_dates_set",
	"project.delete": "project.deleted",
	"project.rebalance": "project.rebalanced",
	"payment.squareUp": "payment.squared_up",
	"sharedExpense.answerShare": (value) =>
		(value as { answer?: unknown } | undefined)?.answer === "reject"
			? "shared_expense.rejected"
			: "shared_expense.accepted",
	"sharedExpense.restoreAnswer": "shared_expense.undone",
	"sharedExpense.removeSelf": "shared_expense.self_removed",
	"sharedExpense.restoreSelf": "shared_expense.undone",
};

/** The event `mutationId` appends for the result it produced, or null when it has none. */
export function eventTypeOfMutation(
	mutationId: string,
	value: unknown,
): EventType | null {
	if (!Object.hasOwn(MUTATION_EVENTS, mutationId)) return null;
	const name = MUTATION_EVENTS[mutationId] as EventName;
	return typeof name === "function" ? name(value) : name;
}
