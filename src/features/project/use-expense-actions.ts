"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

/**
 * Expense row actions on the project page (the expense registry, R8): Open
 * and Edit (today's expense sheet until 4G's read view lands) and Review,
 * which accepts your share. Accepting moves no figure: a share waiting for
 * you already counts in every balance (numbers.ts, expensesCountedFor).
 * Delete, Split, Correct and the rest need their previews first (4G), so
 * they have no handler here and stay hidden.
 */
export function useExpenseActions(
	projectId: string,
): ActionHandlers<ExpenseTarget> {
	const t = useTranslations("projectV2.toast");
	const toast = useToast();
	const utils = api.useUtils();
	const { openSharedExpense } = useExpenseModal();
	const accept = api.verification.accept.useMutation({
		onSuccess: () => {
			void utils.project.pageView.invalidate({ id: projectId });
			void utils.verification.queue.invalidate();
		},
	});
	return useMemo(
		() => ({
			open: (x) => openSharedExpense(x.id),
			edit: (x) => openSharedExpense(x.id),
			review: async (x) => {
				await accept.mutateAsync({ txnId: x.id });
				toast.saved(t("accepted", { name: x.name }));
			},
		}),
		[accept, openSharedExpense, t, toast],
	);
}
