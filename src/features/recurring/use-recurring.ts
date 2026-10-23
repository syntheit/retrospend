"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import type { RecurringTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useRecurringModal } from "~/components/recurring-modal-provider";
import { useToast } from "~/components/ui/toast";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { api } from "~/trpc/react";
import { saveError } from "../activity/error-code";
import { isDue } from "./groups";

/** Due, and its amount is fixed: Confirm books it as it is. */
export const canConfirm = (r: RecurringItemDTO) =>
	isDue(r) && r.amountMode === "fixed";

/**
 * The Recurring tab's read and the recurring registry's handlers (R8).
 * Edit and Add use today's recurring modal until its sheet is rebuilt.
 * Confirm opens the confirm step first (R30); a template whose amount
 * varies needs the Confirm sheet's amount field (2E), so it has no Confirm
 * here. Skip waits for a server skip (2E), so it has no handler either.
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
	const [confirming, setConfirming] = useState<RecurringItemDTO | null>(null);
	// Templates with a save in flight: their Confirm and Auto-pay controls wait.
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const mark = useCallback(
		(id: string, on: boolean) =>
			setBusy((prev) => {
				const next = new Set(prev);
				if (on) next.add(id);
				else next.delete(id);
				return next;
			}),
		[],
	);
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
				toast.failed(t(`error.${saveError(error)}`));
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
		async (r: RecurringItemDTO, autoPay: boolean) => {
			mark(r.id, true);
			await run(
				() => update.mutateAsync({ id: r.id, autoPay }),
				t(autoPay ? "autoPayOn" : "autoPayOff", { name: r.title }),
				() => update.mutateAsync({ id: r.id, autoPay: !autoPay }),
			);
			mark(r.id, false);
		},
		[run, update, t, mark],
	);

	/**
	 * Books the due expense from the confirm step. A failure throws its own
	 * words, so the sheet stays open with them inline (never the server's
	 * text). No Undo yet: undoing needs a server step back (GAPS).
	 */
	const book = useCallback(
		async (r: RecurringItemDTO) => {
			mark(r.id, true);
			try {
				// The due date guards a double confirm (the server refuses a second one).
				await confirm.mutateAsync({ id: r.id, dueDate: new Date(r.dueAt) });
				toast.saved(t("logged", { name: r.title }));
			} catch (error) {
				throw new Error(t(`error.${saveError(error)}`));
			} finally {
				mark(r.id, false);
				await refresh();
			}
		},
		[confirm, toast, t, refresh, mark],
	);

	const handlers = useMemo<ActionHandlers<RecurringTarget>>(() => {
		const item = (target: RecurringTarget) => byId.get(target.id);
		const on =
			(fn: (r: RecurringItemDTO) => unknown) => (target: RecurringTarget) => {
				const r = item(target);
				return r ? fn(r) : undefined;
			};
		return {
			confirm: on(setConfirming),
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
	}, [byId, modal, setActive, run, remove, t]);

	// Confirm only books a due one; the server refuses an early confirm.
	const notDue = useMemo(() => {
		const { confirm: _confirm, ...rest } = handlers;
		return rest;
	}, [handlers]);
	const handlersFor = useCallback(
		(r: RecurringItemDTO) => (canConfirm(r) ? handlers : notDue),
		[handlers, notDue],
	);

	return {
		view,
		handlersFor,
		/** Opens the confirm step for a due template. */
		askConfirm: setConfirming,
		confirming,
		closeConfirm: () => setConfirming(null),
		book,
		busy,
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
