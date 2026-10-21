/**
 * Allocation of a payment entered in the GLOBAL (People) view across the
 * pair's per-scope balances.
 *
 * Settlements are project-scoped: every project view only counts settlement
 * rows stamped with that project, and the global view is the sum of all scopes
 * (each project plus the direct / project-less bucket). A payment recorded
 * from the global view therefore has to be split into one settlement row per
 * scope, otherwise the project views never see it and keep showing the debt.
 *
 * Rules:
 * - Only scopes where the payer actually owes the payee are paid down, and a
 *   scope never receives more than it owes, so no scope can flip into a
 *   reverse debt (the per-scope over-payment cap).
 * - Smallest debts are cleared first so that as many scopes as possible end up
 *   fully settled. Ties: the direct bucket first, then by projectId, so the
 *   result is deterministic.
 * - The caller enforces the GLOBAL cap (amount <= global amount owed, with a
 *   small tolerance). Since the global balance is the sum of every scope, the
 *   owed scopes always cover it. Any tolerance-level remainder is added to the
 *   last allocated row so the rows sum exactly to the amount paid.
 */

export interface ScopeDebt {
	/** Project the debt lives in; `null` = direct / project-less expenses. */
	projectId: string | null;
	/** Amount the payer owes the payee in this scope (positive). */
	owed: number;
}

export interface ScopeAllocation {
	projectId: string | null;
	amount: number;
}

const DUST = 0.00000001;

export function allocateAcrossScopes(
	debts: ScopeDebt[],
	amount: number,
): ScopeAllocation[] {
	if (!(amount > DUST)) return [];

	const ordered = debts
		.filter((d) => d.owed > DUST)
		.sort((a, b) => {
			if (Math.abs(a.owed - b.owed) > DUST) return a.owed - b.owed;
			if (a.projectId === b.projectId) return 0;
			if (a.projectId === null) return -1;
			if (b.projectId === null) return 1;
			return a.projectId < b.projectId ? -1 : 1;
		});

	const allocations: ScopeAllocation[] = [];
	let remaining = amount;
	for (const debt of ordered) {
		if (remaining <= DUST) break;
		const portion = Math.min(remaining, debt.owed);
		allocations.push({ projectId: debt.projectId, amount: portion });
		remaining -= portion;
	}

	if (remaining > DUST) {
		if (allocations.length > 0) {
			// Within the caller's tolerance: fold into the last row.
			allocations[allocations.length - 1]!.amount += remaining;
		} else {
			// Nothing is owed in any scope (only reachable within the caller's
			// tolerance): record it as a direct settlement.
			allocations.push({ projectId: null, amount: remaining });
		}
	}

	return allocations;
}

/**
 * Turns a per-scope balance map (from computeBalanceByProject, signed from the
 * payer's side: negative = payer owes) into the debts owed in one currency.
 */
export function scopeDebtsForCurrency(
	byProject: Map<string | null, Record<string, number>>,
	currency: string,
): ScopeDebt[] {
	const debts: ScopeDebt[] = [];
	for (const [projectId, byCurrency] of byProject) {
		const balance = byCurrency[currency] ?? 0;
		if (balance < -DUST) debts.push({ projectId, owed: -balance });
	}
	return debts;
}
