"use client";

import { useMemo } from "react";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useEntrySheets } from "~/features/entry/context";
import { useEntryActions } from "~/features/entry/entry-actions";

/**
 * Expense row actions on the project page (the expense registry, R8): Open
 * and Edit (today's expense sheet until 4G's read view lands) and Review,
 * which opens the review sheet (Accept or Reject, each with its preview and
 * Undo) instead of answering in one tap. Delete, Split, Correct and the rest
 * need their previews first (4G), so they have no handler here and stay
 * hidden.
 */
export function useExpenseActions(
	onReview: (expenseId: string) => void,
): ActionHandlers<ExpenseTarget> {
	const { openSharedExpense } = useEntryActions();
	const sheets = useEntrySheets();
	return useMemo(
		() => ({
			open: (x) => openSharedExpense(x.id),
			edit: (x) => sheets.open({ kind: "shared", id: x.id }),
			review: (x) => onReview(x.id),
		}),
		[onReview, openSharedExpense, sheets],
	);
}
