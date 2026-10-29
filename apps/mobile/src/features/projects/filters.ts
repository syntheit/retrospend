import type { ReviewNeed } from "@/features/people/ReviewSheet";
import type { NeedsItem } from "@/features/people/source";
import type { ProjectExpense } from "./source";

/** "me", or a payer's name: who an expense is narrowed to. Null is anyone. */
export type PaidBy = string | null;

export const ME = "me";

/** The key a row's payer is filtered by. */
export function payerKey(expense: ProjectExpense): string | null {
	return expense.payerIsMe ? ME : expense.payerName;
}

/** The expenses the toolbar chips keep: only those to review, and only one payer's. */
export function filterExpenses(
	expenses: ProjectExpense[],
	filter: { toReview: boolean; paidBy: PaidBy },
): ProjectExpense[] {
	return expenses.filter(
		(e) =>
			(!filter.toReview || e.waiting === "review") &&
			(filter.paidBy === null || payerKey(e) === filter.paidBy),
	);
}

/** Who paid something in these expenses: you first, then names in the order they come. */
export function payers(expenses: ProjectExpense[]): string[] {
	const keys = expenses
		.map(payerKey)
		.filter((key): key is string => key !== null);
	const unique = [...new Set(keys)];
	return [...unique.filter((k) => k === ME), ...unique.filter((k) => k !== ME)];
}

/**
 * The splits of this project that wait on you, from your whole Needs you
 * list: the review items whose expense is one of the project's.
 */
export function projectNeeds(
	needs: NeedsItem[],
	expenses: { id: string }[],
): ReviewNeed[] {
	const ids = new Set(expenses.map((e) => e.id));
	return needs.filter(
		(n): n is ReviewNeed => n.kind === "verify" && ids.has(n.id),
	);
}
