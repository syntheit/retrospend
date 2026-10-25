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
	"insights",
	"billingPeriod",
	"expense",
	"envelope",
] as const;

// The envelope budget reads every expense, share and settlement (build plan 02 §5.4).
const EXPENSE_DEPS = [
	"insights",
	"envelope",
] as const;

// A payment can lock the splits it settled (2C.2), which Activity and the entry views show.
const SETTLEMENT_DEPS = [
	"people",
	"project",
	"billingPeriod",
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
	"envelope",
] as const;

// Fiscal month start and home currency shift every month-scoped reader.
const GENERAL_SETTINGS_DEPS = [
	"insights",
	"expense",
	"envelope",
] as const;

export const CROSS_ROUTER_INVALIDATIONS: Record<string, readonly string[]> = {
	// ── Shared transactions (project expenses) ──────────────────────────
	"sharedTransaction.create": SHARED_TX_DEPS,
	"sharedTransaction.update": [...SHARED_TX_DEPS, "verification"],
	"sharedTransaction.delete": SHARED_TX_DEPS,

	// ── Envelope budget ─────────────────────────────────────────────────
	// Setup writes the starting balance row.
	"envelope.setup": ["expense"],
	"envelope.mergeEnvelopes": ["insights", "project"],
	"envelope.archiveEnvelope": ["insights", "project"],
	"envelope.undoChange": [
		"insights",
		"project",
		"expense",
	],
	"envelope.confirmStartingMoney": ["expense"],
	// Style, period and routing change what reports group and the dashboard shows.
	"envelope.setStyle": ["insights"],
	"envelope.revertStyle": ["insights"],
	"envelope.setBookPeriod": ["insights"],
	"envelope.setProjectRouting": ["insights", "project"],
	"envelope.setShareCategory": ["expense", "insights"],
	// These write Adjustment money-in rows.
	"envelope.reconcile": ["expense"],
	"envelope.removeAdjustment": ["expense"],
	"envelope.welcomeBack": ["expense"],
	// Debts: terms and the plan change the Wealth liability view and bills;
	// a payment moves accounts, the liability and the budget.
	// A hidden-rows answer changes the row's flags: lists, stats and the budget.
	"envelope.resolveHidden": ["expense", "insights"],
	"envelope.revertHidden": ["expense", "insights"],
	"envelope.dismissMigrationNotice": [],
	"envelope.setDebtTerms": ["wealth"],
	"envelope.recordDebtPayment": [
		"wealth",
		"expense",
		"insights",
	],
	"envelope.forgive": [
		"people",
		"home",
		"expense",
		"sharedTransaction",
	],
	"envelope.unforgive": [
		"people",
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
	"expense.bulkUpdateCategory": ["insights"],

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
	"entry.transfer.save": ["wealth", "expense", "envelope"],
	// Income feeds Insights' money in and savings rate.
	"wealth.income.add.save": [
		"insights",
		"expense",
		"envelope",
		"recurring",
	],
	"wealth.income.delete.save": [
		"insights",
		"expense",
		"envelope",
		"recurring",
	],
	"wealth.transfers.delete.save": ["expense", "envelope", "entry"],

	// ── Settlements ─────────────────────────────────────────────────────
	"settlement.create": SETTLEMENT_DEPS,
	"settlement.settleAll": SETTLEMENT_DEPS,
	"settlement.reject": SETTLEMENT_DEPS,
	// Settle all in one project (and its Undo) records or removes payments.
	"project.settleAll": SETTLEMENT_DEPS,
	"project.settleAllUndo": SETTLEMENT_DEPS,

	// ── Billing periods ─────────────────────────────────────────────────
	"billingPeriod.closeCurrent": [
		"project",
		"sharedTransaction",
		"people",
		"insights",
	],
	"billingPeriod.settlePeriod": [
		"project",
		"settlement",
		"people",
		"insights",
	],
	"billingPeriod.updateLabel": ["project"],

	// ── Categories ──────────────────────────────────────────────────────
	"categories.update": CATEGORY_DEPS,
	"categories.delete": CATEGORY_DEPS,

	// ── Recurring ───────────────────────────────────────────────────────
	"recurring.confirmAndCreate": [
		"expense",
		"insights",
		"sharedTransaction",
	],

	// ── Verification ────────────────────────────────────────────────────
	"verification.accept": ["project", "people", "sharedTransaction", "expense"],
	"verification.reject": ["project", "people", "sharedTransaction"],

	// ── Import ──────────────────────────────────────────────────────────
	// The Import page (uiV2): one batch in, or the batch out again.
	"importQueue.commit": [...EXPENSE_DEPS, "expense", "entry"],
	"importQueue.undo": [...EXPENSE_DEPS, "expense", "entry"],

	// ── Project ─────────────────────────────────────────────────────────
	"project.create": [],
	"project.update": [],
	"project.delete": [],
	// Hide from reports moves every spending total, Insights included.
	"project.updateAnalyticsExclusion": ["insights"],
	"project.addParticipant": ["people"],
	"project.removeParticipant": ["people"],

	// ── Exchange rates ──────────────────────────────────────────────────
	"exchangeRate.syncNow": [
		"wealth",
		"project",
		"people",
		"insights",
	],

	// ── Guest ───────────────────────────────────────────────────────────
	"guest.joinWithAccount": ["project", "people"],

	// ── User ────────────────────────────────────────────────────────────
	"user.updateProfile": ["profile"],

	// ── Preferences (favorites affect dashboard) ────────────────────────
	"preferences.updateAnalyticsCategoryPreference": [],
	"preferences.deleteAnalyticsCategoryPreference": [],

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
	// A preview is the write run and rolled back (R30): nothing it read has changed.
	if (path.endsWith(".preview")) return;

	const ownRouter = path.split(".")[0]!;
	const additional = CROSS_ROUTER_INVALIDATIONS[path] ?? [];

	for (const router of new Set([ownRouter, ...additional])) {
		void queryClient.invalidateQueries({ queryKey: [[router]] });
	}
}
