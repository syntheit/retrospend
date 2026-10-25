"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { useEntrySheets } from "~/features/entry/context";
import { useToast } from "~/components/ui/toast";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import { api } from "~/trpc/react";
import { saveError } from "./error-code";
import { opens } from "./to-vm";

/** lockStates takes at most this many ids. */
const LOCK_CHUNK = 200;

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
	const sheets = useEntrySheets();
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const refresh = useCallback(() => utils.expense.listV2.invalidate(), [utils]);
	// Personal rows go through the money mutation, which returns a signed
	// restore token, so the toast's Undo brings back the same row (R15).
	const deletePersonal = api.entry.expense.delete.save.useMutation();
	const restorePersonal = api.entry.expense.restore.save.useMutation();
	const deleteShared = api.sharedTransaction.delete.useMutation();
	// Who may ask to fix or correct comes from the corrections router, 200 rows a read.
	const sharedChunks = useMemo(() => {
		const ids = rows
			.filter((r) => r.source === "shared" && opens(r))
			.map((r) => r.entityId);
		return Array.from({ length: Math.ceil(ids.length / LOCK_CHUNK) }, (_, i) =>
			ids.slice(i * LOCK_CHUNK, (i + 1) * LOCK_CHUNK),
		);
	}, [rows]);
	const locks = api.useQueries((t) =>
		sharedChunks.map((transactionIds) =>
			t.corrections.lockStates({ transactionIds }),
		),
	);
	const stamp = locks.map((q) => q.dataUpdatedAt).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on when the answers arrived
	const lockOf = useMemo(
		() =>
			new Map(
				locks.flatMap((q) => q.data ?? []).map((l) => [l.transactionId, l]),
			),
		[stamp],
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
			// The sheet itself opens, with the read view behind it.
			askFix: (target) => {
				const r = row(target);
				if (r) sheets.open({ kind: "shared", id: r.entityId, start: "ask" });
			},
			correct: (target) => {
				const r = row(target);
				if (r)
					sheets.open({ kind: "shared", id: r.entityId, start: "correct" });
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
		sheets,
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
