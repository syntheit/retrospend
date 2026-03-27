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
	"billingPeriod",
	"expense",
] as const;

const EXPENSE_DEPS = ["dashboard", "budget", "stats"] as const;

const SETTLEMENT_DEPS = [
	"people",
	"project",
	"billingPeriod",
	"dashboard",
	"stats",
] as const;

const CATEGORY_DEPS = [
	"expense",
	"sharedTransaction",
	"project",
	"dashboard",
] as const;

const CROSS_ROUTER_INVALIDATIONS: Record<string, readonly string[]> = {
	// ── Shared transactions (project expenses) ──────────────────────────
	"sharedTransaction.create": SHARED_TX_DEPS,
	"sharedTransaction.update": [...SHARED_TX_DEPS, "verification"],
	"sharedTransaction.delete": SHARED_TX_DEPS,

	// ── Personal expenses ───────────────────────────────────────────────
	"expense.createExpense": EXPENSE_DEPS,
	"expense.updateExpense": EXPENSE_DEPS,
	"expense.deleteExpense": EXPENSE_DEPS,
	"expense.importExpenses": EXPENSE_DEPS,
	"expense.bulkUpdateCategory": ["dashboard", "stats"],

	// ── Settlements ─────────────────────────────────────────────────────
	"settlement.create": SETTLEMENT_DEPS,
	"settlement.confirm": SETTLEMENT_DEPS,
	"settlement.reject": SETTLEMENT_DEPS,
	"settlement.deletePending": SETTLEMENT_DEPS,

	// ── Billing periods ─────────────────────────────────────────────────
	"billingPeriod.closeCurrent": [
		"project",
		"sharedTransaction",
		"people",
		"stats",
	],
	"billingPeriod.settlePeriod": [
		"project",
		"settlement",
		"people",
		"stats",
	],
	"billingPeriod.updateLabel": ["project"],

	// ── Categories ──────────────────────────────────────────────────────
	"categories.update": CATEGORY_DEPS,
	"categories.delete": CATEGORY_DEPS,

	// ── Recurring ───────────────────────────────────────────────────────
	"recurring.executeNow": [
		"expense",
		"dashboard",
		"budget",
		"stats",
		"sharedTransaction",
	],

	// ── Verification ────────────────────────────────────────────────────
	"verification.accept": [
		"project",
		"people",
		"sharedTransaction",
		"expense",
	],
	"verification.reject": ["project", "people", "sharedTransaction"],

	// ── Import ──────────────────────────────────────────────────────────
	"importQueue.finalizeImport": ["expense", "dashboard", "budget", "stats"],

	// ── Project ─────────────────────────────────────────────────────────
	"project.create": ["dashboard"],
	"project.update": ["dashboard"],
	"project.delete": ["dashboard"],
	"project.updateAnalyticsExclusion": ["dashboard"],
	"project.addParticipant": ["people"],
	"project.removeParticipant": ["people"],

	// ── Exchange rates ──────────────────────────────────────────────────
	"exchangeRate.syncNow": [
		"dashboard",
		"wealth",
		"project",
		"people",
		"stats",
	],

	// ── Guest ───────────────────────────────────────────────────────────
	"guest.upgradeToProject": ["project"],
	"guest.acceptMagicLink": ["project"],

	// ── User ────────────────────────────────────────────────────────────
	"user.updateProfile": ["profile"],

	// ── Preferences (favorites affect dashboard) ────────────────────────
	"preferences.updateAnalyticsCategoryPreference": ["dashboard"],
	"preferences.deleteAnalyticsCategoryPreference": ["dashboard"],

	// ── Audit log ───────────────────────────────────────────────────────
	"auditLog.markTransactionSeen": ["project", "sharedTransaction"],

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
