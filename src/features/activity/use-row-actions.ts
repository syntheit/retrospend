"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useToast } from "~/components/ui/toast";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import { api } from "~/trpc/react";

/**
 * The expense registry's handlers for Activity rows (R8). Edit and Add go
 * through today's expense modal until the Add family sheets land (4G);
 * an action with no handler here is not shown. Payments have no actions
 * yet (their read view comes with People, 4D).
 */
export function useRowActions(rows: ActivityRowDTO[]) {
	const t = useTranslations("activity.actions");
	const toast = useToast();
	const utils = api.useUtils();
	const modal = useExpenseModal();
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const refresh = useCallback(() => utils.expense.listV2.invalidate(), [utils]);
	const deletePersonal = api.expense.deleteExpense.useMutation();
	const deleteShared = api.sharedTransaction.delete.useMutation();

	const open = useCallback(
		(row: ActivityRowDTO) => {
			if (row.source === "personal") modal.openExpense(row.entityId);
			else if (row.source === "shared") modal.openSharedExpense(row.entityId);
		},
		[modal],
	);

	const handlers = useMemo<ActionHandlers<ExpenseTarget>>(() => {
		const row = (target: ExpenseTarget) => byId.get(target.id);
		return {
			edit: (target) => {
				const r = row(target);
				if (r) open(r);
			},
			duplicate: (target) => {
				const r = row(target);
				if (!r || r.source === "payment") return;
				modal.openDuplicateExpense({
					title: r.title,
					amount: Number(fromMinor(r.amount)),
					currency: r.amount.currency,
					categoryId: r.category?.id ?? null,
				});
			},
			delete: async (target) => {
				const r = row(target);
				if (!r) return;
				try {
					if (r.source === "personal")
						await deletePersonal.mutateAsync({ id: r.entityId });
					else await deleteShared.mutateAsync({ id: r.entityId });
					toast.saved(t("deleted", { name: target.name }));
				} catch (error) {
					toast.failed(error instanceof Error ? error.message : t("failed"));
				}
				await refresh();
			},
		};
	}, [byId, open, modal, deletePersonal, deleteShared, refresh, toast, t]);

	/** Rows whose menu has these actions; payments get none. */
	const handlersFor = useCallback(
		(r: ActivityRowDTO): ActionHandlers<ExpenseTarget> =>
			r.source === "payment" ? {} : handlers,
		[handlers],
	);

	return { handlersFor, open };
}
