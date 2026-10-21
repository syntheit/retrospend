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
 *   owed scopes always cover the amount owed. A tolerance-level excess beyond
 *   every scope's debt is dropped rather than recorded: adding it to a row
 *   would leave that scope with a cent of reverse debt.
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

/**
 * The opposite of {@link scopeDebtsForCurrency}: the scopes where the PAYEE
 * owes the payer in one currency (positive balance from the payer's side).
 */
export function reverseScopeDebtsForCurrency(
	byProject: Map<string | null, Record<string, number>>,
	currency: string,
): ScopeDebt[] {
	const debts: ScopeDebt[] = [];
	for (const [projectId, byCurrency] of byProject) {
		const balance = byCurrency[currency] ?? 0;
		if (balance > DUST) debts.push({ projectId, owed: balance });
	}
	return debts;
}

/** Rows of a full settle-up in one currency, see allocateFullSettlement. */
export interface FullSettlementRows {
	cash: ScopeAllocation[];
	payerOffsets: ScopeAllocation[];
	payeeOffsets: ScopeAllocation[];
}

/**
 * Rows of a full settle-up in one currency, when the pair also has debts
 * going the other way in some scopes.
 *
 * Example: the payer owes 50 in Trip and is owed 30 in Rent, so the global
 * balance is 20. Paying only the 20 into Trip would leave Trip at "you owe
 * 30" and Rent at "they owe you 30" while the global view says even. A full
 * settle-up therefore also cancels the opposite debts:
 * - `cash`: the money actually paid (the net), allocated over the payer's
 *   debts like any global payment (allocateAcrossScopes).
 * - `payeeOffsets`: payee -> payer, one per scope where the payee owes, for
 *   that scope's full debt. Moves no cash.
 * - `payerOffsets`: payer -> payee, covering the payer's debts the cash did
 *   not reach, adding up to the same total as `payeeOffsets`. Moves no cash.
 * Every scope ends at zero and the offsets cancel out globally, so cash moved
 * is still exactly the net.
 *
 * `cash` must not exceed the net (payer debts minus payee debts); the caller
 * caps it at the global amount owed. With no payee debts this is a plain
 * global allocation.
 */
export function allocateFullSettlement(
	payerDebts: ScopeDebt[],
	payeeDebts: ScopeDebt[],
	cash: number,
): FullSettlementRows {
	const cashRows = allocateAcrossScopes(payerDebts, cash);

	const payeeOffsets = allocateAcrossScopes(
		payeeDebts,
		payeeDebts.reduce((sum, d) => sum + Math.max(0, d.owed), 0),
	);
	const offsetTotal = payeeOffsets.reduce((sum, a) => sum + a.amount, 0);

	// What each payer scope still owes after the cash.
	const paid = new Map<string | null, number>();
	for (const row of cashRows) {
		paid.set(row.projectId, (paid.get(row.projectId) ?? 0) + row.amount);
	}
	const residual = payerDebts.map((d) => ({
		projectId: d.projectId,
		owed: d.owed - (paid.get(d.projectId) ?? 0),
	}));
	const payerOffsets = allocateAcrossScopes(residual, offsetTotal);

	return { cash: cashRows, payerOffsets, payeeOffsets };
}
