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
import { saveError } from "./error-code";
import { opens } from "./to-vm";

/**
 * The expense registry's handlers for Activity rows (R8). Edit and Add go
 * through today's expense modal until the Add family sheets land (4G);
 * an action with no handler here is not shown. Payments have no actions
 * yet (their read view comes with People, 4D); money in, refunds and
 * transfers only Delete until their own sheets land (4G).
 */
export function useRowActions(rows: ActivityRowDTO[]) {
	const t = useTranslations("activity.actions");
	const toast = useToast();
	const utils = api.useUtils();
	const modal = useExpenseModal();
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const refresh = useCallback(() => utils.expense.listV2.invalidate(), [utils]);
	// Personal rows go through the money mutation, which returns a signed
	// restore token, so the toast's Undo brings back the same row (R15).
	const deletePersonal = api.entry.expense.delete.save.useMutation();
	const restorePersonal = api.entry.expense.restore.save.useMutation();
	const deleteShared = api.sharedTransaction.delete.useMutation();
	// Who may ask to fix or correct comes from the corrections router, once for the page.
	const sharedIds = useMemo(
		() =>
			rows
				.filter((r) => r.source === "shared" && opens(r))
				.map((r) => r.entityId)
				.slice(0, 200),
		[rows],
	);
	const locks = api.corrections.lockStates.useQuery(
		{ transactionIds: sharedIds },
		{ enabled: sharedIds.length > 0 },
	);
	const lockOf = useMemo(
		() => new Map((locks.data ?? []).map((l) => [l.transactionId, l])),
		[locks.data],
	);

	const open = useCallback(
		(row: ActivityRowDTO) => {
			if (!opens(row)) return;
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
			// The read view holds Ask to fix and Correct; the menu only gets there.
			askFix: (target) => {
				const r = row(target);
				if (r) open(r);
			},
			correct: (target) => {
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
					if (r.source === "personal") {
						const out = await deletePersonal.mutateAsync({ id: r.entityId });
						toast.saved(t("deleted", { name: target.name }), {
							undo: async () => {
								await restorePersonal.mutateAsync({ token: out.value.restore });
								await refresh();
							},
						});
					} else {
						await deleteShared.mutateAsync({ id: r.entityId });
						toast.saved(t("deleted", { name: target.name }));
					}
				} catch (error) {
					toast.failed(t(`error.${saveError(error)}`));
				}
				await refresh();
			},
		};
	}, [
		byId,
		open,
		modal,
		deletePersonal,
		restorePersonal,
		deleteShared,
		refresh,
		toast,
		t,
	]);

	const deleteOnly = useMemo(
		() => ({ delete: handlers.delete }),
		[handlers.delete],
	);

	/** Rows whose menu has these actions; payments get none. */
	const handlersFor = useCallback(
		(r: ActivityRowDTO): ActionHandlers<ExpenseTarget> => {
			if (r.source === "payment") return {};
			if (!opens(r)) return deleteOnly;
			const { askFix, correct, ...base } = handlers;
			const lock = lockOf.get(r.entityId);
			return {
				...base,
				...(lock?.canAskToFix ? { askFix } : {}),
				...(lock?.canCorrect ? { correct } : {}),
			};
		},
		[handlers, deleteOnly, lockOf],
	);

	return { handlersFor, open };
}
