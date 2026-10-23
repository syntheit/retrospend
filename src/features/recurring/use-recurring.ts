"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { RecurringTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useRecurringModal } from "~/components/recurring-modal-provider";
import { useToast } from "~/components/ui/toast";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { api } from "~/trpc/react";
import { isDue } from "./groups";

/**
 * The Recurring tab's read and the recurring registry's handlers (R8).
 * Edit and Add use today's recurring modal until its sheet is rebuilt;
 * Skip waits for a server skip (2E), so it has no handler and is not shown.
 */
export function useRecurring() {
	const t = useTranslations("activityRecurring.actions");
	const toast = useToast();
	const utils = api.useUtils();
	const modal = useRecurringModal();
	const view = api.recurring.listView.useQuery();
	const refresh = useCallback(
		() =>
			Promise.all([
				utils.recurring.listView.invalidate(),
				utils.expense.listV2.invalidate(),
			]),
		[utils],
	);
	const update = api.recurring.update.useMutation();
	const confirm = api.recurring.confirmAndCreate.useMutation();
	const remove = api.recurring.delete.useMutation();
	const items = view.data?.items;
	const byId = useMemo(
		() => new Map((items ?? []).map((r) => [r.id, r])),
		[items],
	);

	const run = useCallback(
		async (
			work: () => Promise<unknown>,
			done: string,
			undo?: () => Promise<unknown>,
		) => {
			try {
				await work();
				toast.saved(
					done,
					undo
						? {
								undo: async () => {
									await undo();
									await refresh();
								},
							}
						: undefined,
				);
			} catch (error) {
				toast.failed(error instanceof Error ? error.message : t("failed"));
			}
			await refresh();
		},
		[toast, refresh, t],
	);

	const setActive = useCallback(
		(r: RecurringItemDTO, isActive: boolean) =>
			run(
				() => update.mutateAsync({ id: r.id, isActive }),
				t(isActive ? "resumed" : "paused", { name: r.title }),
				() => update.mutateAsync({ id: r.id, isActive: !isActive }),
			),
		[run, update, t],
	);

	const setAutoPay = useCallback(
		(r: RecurringItemDTO, autoPay: boolean) =>
			run(
				() => update.mutateAsync({ id: r.id, autoPay }),
				t(autoPay ? "autoPayOn" : "autoPayOff", { name: r.title }),
				() => update.mutateAsync({ id: r.id, autoPay: !autoPay }),
			),
		[run, update, t],
	);

	const confirmOne = useCallback(
		(r: RecurringItemDTO) =>
			run(
				// The due date guards a double confirm (the server refuses a second one).
				() => confirm.mutateAsync({ id: r.id, dueDate: new Date(r.dueAt) }),
				t("logged", { name: r.title }),
			),
		[run, confirm, t],
	);

	const handlers = useMemo<ActionHandlers<RecurringTarget>>(() => {
		const item = (target: RecurringTarget) => byId.get(target.id);
		const on =
			(fn: (r: RecurringItemDTO) => unknown) => (target: RecurringTarget) => {
				const r = item(target);
				return r ? fn(r) : undefined;
			};
		return {
			confirm: on(confirmOne),
			editAmount: on((r) => modal.openRecurring(r.id)),
			pause: on((r) => setActive(r, false)),
			resume: on((r) => setActive(r, true)),
			delete: on((r) =>
				run(
					() => remove.mutateAsync({ id: r.id }),
					t("deleted", { name: r.title }),
				),
			),
		};
	}, [byId, confirmOne, modal, setActive, run, remove, t]);

	// Confirm only books a due one; the server refuses an early confirm.
	const notDue = useMemo(() => {
		const { confirm: _confirm, ...rest } = handlers;
		return rest;
	}, [handlers]);
	const handlersFor = useCallback(
		(r: RecurringItemDTO) => (isDue(r) ? handlers : notDue),
		[handlers, notDue],
	);

	return {
		view,
		handlersFor,
		confirmOne,
		setAutoPay,
		openNew: modal.openNewRecurring,
		edit: modal.openRecurring,
	};
}

/** The registry target for a template. */
export const targetOf = (r: RecurringItemDTO): RecurringTarget => ({
	id: r.id,
	name: r.title,
	paused: r.paused,
});
