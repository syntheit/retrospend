import type { QueryClient } from "@tanstack/react-query";

/**
 * Centralized mutation → query invalidation map.
 *
 * Every tRPC mutation automatically invalidates its own router's queries.
 * This map declares ADDITIONAL cross-router invalidations — the routers
 * whose queries should also be refreshed when a given mutation succeeds.
 *
 * Adding a new mutation? If it only affects its own router, no entry needed.
 * If it touches data in other routers, add an entry here.
 *
 * Router names must match the keys in `src/server/api/root.ts`.
 * Mutation names must match the procedure names in each router file.
 */

// Shared dependency lists for mutations that affect the same set of routers.
const SHARED_TX_DEPS = [
	"project",
	"people",
	"budget",
	"dashboard",
	"stats",
	"insights",
	"billingPeriod",
	"expense",
	"envelope",
] as const;

// The envelope budget reads every expense, share and settlement (build plan 02 §5.4).
const EXPENSE_DEPS = [
	"dashboard",
	"budget",
	"stats",
	"insights",
	"envelope",
] as const;

// A payment can lock the splits it settled (2C.2), which Activity and the entry views show.
const SETTLEMENT_DEPS = [
	"people",
	"project",
	"billingPeriod",
	"dashboard",
	"stats",
	"insights",
	"envelope",
	"expense",
	"sharedTransaction",
] as const;

const CATEGORY_DEPS = [
	"insights",
	"expense",
	"sharedTransaction",
	"project",
	"dashboard",
	"budget",
	"envelope",
] as const;

// Budgets feed the dashboard overview (budget totals, remaining).
const BUDGET_DEPS = ["dashboard"] as const;

// Fiscal month start and home currency shift every month-scoped reader.
const GENERAL_SETTINGS_DEPS = [
	"dashboard",
	"budget",
	"stats",
	"insights",
	"expense",
	"envelope",
] as const;

// Envelope writes move the budget figures the dashboard shows.
const ENVELOPE_DEPS = ["dashboard"] as const;

export const CROSS_ROUTER_INVALIDATIONS: Record<string, readonly string[]> = {
	// ── Shared transactions (project expenses) ──────────────────────────
	"sharedTransaction.create": SHARED_TX_DEPS,
	"sharedTransaction.update": [...SHARED_TX_DEPS, "verification"],
	"sharedTransaction.delete": SHARED_TX_DEPS,

	// ── Envelope budget ─────────────────────────────────────────────────
	// Setup writes the starting balance row.
	"envelope.setup": ["dashboard", "expense"],
	"envelope.assign": ENVELOPE_DEPS,
	"envelope.move": ENVELOPE_DEPS,
	"envelope.cover": ENVELOPE_DEPS,
	"envelope.undo": ENVELOPE_DEPS,
	"envelope.carryOverspend": ENVELOPE_DEPS,
	"envelope.fixNegative": ENVELOPE_DEPS,
	"envelope.reset": ENVELOPE_DEPS,
	"envelope.setLimit": ENVELOPE_DEPS,
	"envelope.revertLimit": ENVELOPE_DEPS,
	"envelope.acknowledgeMonth": ENVELOPE_DEPS,
	"envelope.pause": ENVELOPE_DEPS,
	"envelope.resume": ENVELOPE_DEPS,
	"envelope.applyRuleToMonth": ENVELOPE_DEPS,
	"envelope.createRule": ENVELOPE_DEPS,
	"envelope.updateRule": ENVELOPE_DEPS,
	"envelope.reorderRules": ENVELOPE_DEPS,
	"envelope.archiveRule": ENVELOPE_DEPS,
	"envelope.applyDraft": ENVELOPE_DEPS,
	"envelope.unapplyDraft": ENVELOPE_DEPS,
	"envelope.fundPlanNow": ENVELOPE_DEPS,
	"envelope.setGroupTarget": ENVELOPE_DEPS,
	"envelope.setTarget": ENVELOPE_DEPS,
	"envelope.createEnvelope": ENVELOPE_DEPS,
	"envelope.updateEnvelope": ENVELOPE_DEPS,
	"envelope.mergeEnvelopes": ["dashboard", "stats", "insights", "project"],
	"envelope.archiveEnvelope": ["dashboard", "stats", "insights", "project"],
	"envelope.undoChange": [
		"dashboard",
		"stats",
		"insights",
		"project",
		"expense",
	],
	"envelope.confirmStartingMoney": ["dashboard", "expense"],
	// Style, period and routing change what reports group and the dashboard shows.
	"envelope.setStyle": ["dashboard", "stats", "insights"],
	"envelope.revertStyle": ["dashboard", "stats", "insights"],
	"envelope.setBookPeriod": ["dashboard", "stats", "insights"],
	"envelope.setProjectRouting": ["dashboard", "stats", "insights", "project"],
	"envelope.setShareCategory": ["expense", "stats", "insights"],
	// These write Adjustment money-in rows.
	"envelope.reconcile": ["dashboard", "expense"],
	"envelope.removeAdjustment": ["dashboard", "expense"],
	"envelope.welcomeBack": ["dashboard", "expense"],
	// Debts: terms and the plan change the Wealth liability view and bills;
	// a payment moves accounts, the liability and the budget.
	// A hidden-rows answer changes the row's flags: lists, stats and the budget.
	"envelope.resolveHidden": ["dashboard", "expense", "stats", "insights"],
	"envelope.revertHidden": ["dashboard", "expense", "stats", "insights"],
	"envelope.dismissMigrationNotice": [],
	"envelope.setDebtTerms": ["wealth", "dashboard"],
	"envelope.savePayoffPlan": ENVELOPE_DEPS,
	"envelope.revertPayoffPlan": ENVELOPE_DEPS,
	"envelope.recordDebtPayment": [
		"wealth",
		"expense",
		"dashboard",
		"stats",
		"insights",
	],
	"envelope.forgive": [
		"people",
		"dashboard",
		"home",
		"expense",
		"sharedTransaction",
	],
	"envelope.unforgive": [
		"people",
		"dashboard",
		"home",
		"expense",
		"sharedTransaction",
	],

	// ── Corrections, Ask to fix and Forgive (2C.2) ───────────────────────
	// A correction moves balances, spending and the budget, and answers fix requests.
	"corrections.correct.save": [
		...SHARED_TX_DEPS,
		"sharedTransaction",
		"verification",
		"home",
	],
	"corrections.undoCorrection.save": [
		...SHARED_TX_DEPS,
		"sharedTransaction",
		"verification",
		"home",
	],
	// Fix requests change the asked person's Needs you list and the split's read view.
	"corrections.askToFix.save": ["home", "people", "sharedTransaction"],
	"corrections.respondToFix.save": ["home", "people", "sharedTransaction"],
	"corrections.cancelFix.save": ["home", "people", "sharedTransaction"],
	"corrections.withdrawFix.save": ["home", "people", "sharedTransaction"],
	"corrections.restoreFix.save": ["home", "people", "sharedTransaction"],
	"corrections.forgive.save": [...SETTLEMENT_DEPS, "home"],
	"corrections.unforgive.save": [...SETTLEMENT_DEPS, "home"],

	// ── Personal expenses ───────────────────────────────────────────────
	"expense.createExpense": EXPENSE_DEPS,
	"expense.updateExpense": EXPENSE_DEPS,
	"expense.deleteExpense": EXPENSE_DEPS,
	"expense.importExpenses": EXPENSE_DEPS,
	"expense.bulkUpdateCategory": ["dashboard", "stats", "insights", "budget"],

	// ── Add family (4G): the same writes through the entry router ─────────
	"entry.expense.create.save": [...EXPENSE_DEPS, "expense"],
	"entry.expense.update.save": [...EXPENSE_DEPS, "expense"],
	"entry.expense.delete.save": [...EXPENSE_DEPS, "expense"],
	"entry.expense.restore.save": [...EXPENSE_DEPS, "expense"],
	"entry.expense.revert.save": [...EXPENSE_DEPS, "expense"],
	"entry.shared.create.save": [...SHARED_TX_DEPS, "sharedTransaction"],
	"entry.shared.update.save": [
		...SHARED_TX_DEPS,
		"sharedTransaction",
		"verification",
	],
	"entry.shared.revert.save": [
		...SHARED_TX_DEPS,
		"sharedTransaction",
		"verification",
	],
	"entry.shared.delete.save": [...SHARED_TX_DEPS, "sharedTransaction"],
	"entry.transfer.save": ["wealth", "expense", "envelope", "dashboard"],
	// Income feeds Insights' money in and savings rate.
	"wealth.income.add.save": [
		"insights",
		"expense",
		"envelope",
		"dashboard",
		"budget",
		"recurring",
	],
	"wealth.income.delete.save": [
		"insights",
		"expense",
		"envelope",
		"dashboard",
		"budget",
		"recurring",
	],
	"wealth.transfers.delete.save": ["expense", "envelope", "dashboard", "entry"],

	// ── Settlements ─────────────────────────────────────────────────────
	"settlement.create": SETTLEMENT_DEPS,
	"settlement.settleAll": SETTLEMENT_DEPS,
	"settlement.confirm": SETTLEMENT_DEPS,
	"settlement.reject": SETTLEMENT_DEPS,
	"settlement.deletePending": SETTLEMENT_DEPS,
	"settlement.void": SETTLEMENT_DEPS,
	"settlement.squareUp": SETTLEMENT_DEPS,
	// Settle all in one project (and its Undo) records or removes payments.
	"project.settleAll": SETTLEMENT_DEPS,
	"project.settleAllUndo": SETTLEMENT_DEPS,

	// ── Billing periods ─────────────────────────────────────────────────
	"billingPeriod.closeCurrent": [
		"project",
		"sharedTransaction",
		"people",
		"stats",
		"insights",
	],
	"billingPeriod.settlePeriod": [
		"project",
		"settlement",
		"people",
		"stats",
		"insights",
	],
	"billingPeriod.updateLabel": ["project"],

	// ── Budgets ─────────────────────────────────────────────────────────
	"budget.upsertBudget": BUDGET_DEPS,
	"budget.batchUpsertBudgets": BUDGET_DEPS,
	"budget.deleteBudget": BUDGET_DEPS,
	"budget.copyFromLastMonth": BUDGET_DEPS,
	"budget.upsertGlobalBudget": BUDGET_DEPS,
	"budget.deleteGlobalBudget": BUDGET_DEPS,
	"budget.importBudgets": BUDGET_DEPS,

	// ── Categories ──────────────────────────────────────────────────────
	"categories.update": CATEGORY_DEPS,
	"categories.delete": CATEGORY_DEPS,

	// ── Recurring ───────────────────────────────────────────────────────
	"recurring.confirmAndCreate": [
		"expense",
		"dashboard",
		"budget",
		"stats",
		"insights",
		"sharedTransaction",
	],

	// ── Verification ────────────────────────────────────────────────────
	"verification.accept": ["project", "people", "sharedTransaction", "expense"],
	"verification.reject": ["project", "people", "sharedTransaction"],

	// ── Import ──────────────────────────────────────────────────────────
	"importQueue.finalizeImport": [
		"expense",
		"dashboard",
		"budget",
		"stats",
		"insights",
	],
	// The Import page (uiV2): one batch in, or the batch out again.
	"importQueue.commit": [...EXPENSE_DEPS, "expense", "entry"],
	"importQueue.undo": [...EXPENSE_DEPS, "expense", "entry"],

	// ── Project ─────────────────────────────────────────────────────────
	"project.create": ["dashboard"],
	"project.update": ["dashboard"],
	"project.delete": ["dashboard"],
	// Hide from reports moves every spending total, Insights included.
	"project.updateAnalyticsExclusion": ["dashboard", "insights"],
	"project.addParticipant": ["people"],
	"project.removeParticipant": ["people"],

	// ── Exchange rates ──────────────────────────────────────────────────
	"exchangeRate.syncNow": [
		"dashboard",
		"wealth",
		"project",
		"people",
		"stats",
		"insights",
	],

	// ── Guest ───────────────────────────────────────────────────────────
	"guest.joinWithAccount": ["project", "people"],

	// ── User ────────────────────────────────────────────────────────────
	"user.updateProfile": ["profile"],

	// ── Preferences (favorites affect dashboard) ────────────────────────
	"preferences.updateAnalyticsCategoryPreference": ["dashboard"],
	"preferences.deleteAnalyticsCategoryPreference": ["dashboard"],

	// ── Audit log ───────────────────────────────────────────────────────
	"auditLog.markTransactionSeen": ["project", "sharedTransaction"],

	// ── Settings ────────────────────────────────────────────────────────
	"settings.updateGeneral": GENERAL_SETTINGS_DEPS,

	// ── Admin ───────────────────────────────────────────────────────────
	"admin.updateSettings": ["settings"],
	"admin.updateAiSettings": ["settings"],
};

/**
 * Extract the dot-separated path from a tRPC mutation key.
 * tRPC v11 keys are always `[string[]]` (e.g. `[['project', 'create']]`).
 */
function getMutationPath(mutationKey: unknown): string | null {
	if (!Array.isArray(mutationKey) || mutationKey.length === 0) return null;
	const first: unknown = mutationKey[0];
	if (Array.isArray(first)) return (first as string[]).join(".");
	return null;
}

/**
 * Called from the global MutationCache onSuccess.
 * Invalidates the mutation's own router + any cross-router dependencies.
 *
 * Uses `queryKey: [[routerName]]` which prefix-matches all tRPC queries
 * under that router via React Query's partial key matching.
 */
export function handleMutationSuccess(
	queryClient: QueryClient,
	mutation: { options: { mutationKey?: readonly unknown[] } },
): void {
	const path = getMutationPath(mutation.options.mutationKey);
	if (!path) return;

	const ownRouter = path.split(".")[0]!;
	const additional = CROSS_ROUTER_INVALIDATIONS[path] ?? [];

	for (const router of new Set([ownRouter, ...additional])) {
		void queryClient.invalidateQueries({ queryKey: [[router]] });
	}
}
