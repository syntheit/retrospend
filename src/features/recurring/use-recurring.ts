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
 * here. Skip opens its own step (nothing is logged, only the date moves) and
 * both end with an Undo toast.
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
	const unconfirm = api.recurring.unconfirm.useMutation();
	const skip = api.recurring.skip.useMutation();
	const unskip = api.recurring.unskip.useMutation();
	const [confirming, setConfirming] = useState<RecurringItemDTO | null>(null);
	const [skipping, setSkipping] = useState<RecurringItemDTO | null>(null);
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
	 * Books the due expense from the confirm step, on the day it was paid when
	 * that is not the due date. A failure throws its own words, so the sheet
	 * stays open with them inline (never the server's text). The toast undoes
	 * it: the entry goes and the template returns to the due date.
	 */
	const book = useCallback(
		async (r: RecurringItemDTO, paidOn?: string) => {
			mark(r.id, true);
			const dueDate = new Date(r.dueAt);
			try {
				// The due date guards a double confirm (the server refuses a second one).
				const done = await confirm.mutateAsync({
					id: r.id,
					dueDate,
					...(paidOn && paidOn !== r.next ? { paidOn } : {}),
				});
				toast.saved(t("logged", { name: r.title }), {
					undo: async () => {
						await unconfirm.mutateAsync({
							expenseId: done.expenseId,
							dueDate,
						});
						await refresh();
					},
				});
			} catch (error) {
				throw new Error(t(`error.${saveError(error)}`));
			} finally {
				mark(r.id, false);
				await refresh();
			}
		},
		[confirm, unconfirm, toast, t, refresh, mark],
	);

	/**
	 * Skips the due item from the skip step: no entry, the template moves to
	 * its next date. The toast puts it back on the skipped date.
	 */
	const skipItem = useCallback(
		async (r: RecurringItemDTO) => {
			mark(r.id, true);
			const dueDate = new Date(r.dueAt);
			try {
				await skip.mutateAsync({ id: r.id, dueDate });
				toast.saved(t("skipped", { name: r.title }), {
					undo: async () => {
						await unskip.mutateAsync({ id: r.id, dueDate });
						await refresh();
					},
				});
			} catch (error) {
				throw new Error(t(`error.${saveError(error)}`));
			} finally {
				mark(r.id, false);
				await refresh();
			}
		},
		[skip, unskip, toast, t, refresh, mark],
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
			skip: on(setSkipping),
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

	// Confirm and Skip only act on a due one; the server refuses an early one.
	// A template whose amount varies can be skipped but not confirmed here.
	const forms = useMemo(() => {
		const { confirm: _confirm, skip: _skip, ...notDue } = handlers;
		const { confirm: _only, ...skipOnly } = handlers;
		return { notDue, skipOnly };
	}, [handlers]);
	const handlersFor = useCallback(
		(r: RecurringItemDTO) => {
			if (canConfirm(r)) return handlers;
			return isDue(r) ? forms.skipOnly : forms.notDue;
		},
		[handlers, forms],
	);

	return {
		view,
		handlersFor,
		/** Opens the confirm step for a due template. */
		askConfirm: setConfirming,
		confirming,
		closeConfirm: () => setConfirming(null),
		book,
		skipping,
		askSkip: setSkipping,
		closeSkip: () => setSkipping(null),
		skipItem,
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
