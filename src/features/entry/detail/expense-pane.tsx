"use client";

import { useTranslations } from "next-intl";
import { Suspense, useCallback, useMemo } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { DetailPane } from "~/components/ui/detail-pane";
import { useToast } from "~/components/ui/toast";
import { saveError } from "~/features/activity/error-code";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { useEntrySheets } from "../context";
import { useEntryActions } from "../entry-actions";
import { PaneTitle, PersonalFacts } from "./pane-facts";
import { PaneActions, type PaneProps, Waiting } from "./pane-parts";
import { type PaneTarget, usePaneRoute } from "./pane-route";
import { SharedPane } from "./shared-pane";

/** One of your own expenses: facts only, edit in the composer. */
function PersonalPane({ id, onClose, phone }: PaneProps & { id: string }) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const toast = useToast();
	const sheets = useEntrySheets();
	const entry = useEntryActions();
	const utils = api.useUtils();
	const q = api.entry.expense.get.useQuery({ id });
	const del = api.entry.expense.delete.save.useMutation();
	const restore = api.entry.expense.restore.save.useMutation();
	const e = q.data;
	const ta = useTranslations("activity.actions");

	const refresh = useCallback(() => utils.expense.listV2.invalidate(), [utils]);

	const target = useMemo<ExpenseTarget | null>(
		() =>
			e
				? {
						id: e.id,
						name: e.title,
						mine: true,
						locked: false,
						reviewed: true,
						shared: false,
					}
				: null,
		[e],
	);
	const handlers = useMemo<ActionHandlers<ExpenseTarget>>(
		() => ({
			edit: () => sheets.open({ kind: "expense", mode: "edit", id }),
			duplicate: () => {
				if (!e) return;
				entry.openDuplicateExpense({
					title: e.title,
					amount: e.amount,
					currency: e.currency,
					categoryId: e.categoryId,
				});
			},
			delete: async () => {
				if (!e) return;
				try {
					const out = await del.mutateAsync({ id });
					onClose();
					toast.saved(ta("deleted", { name: e.title }), {
						undo: async () => {
							await restore.mutateAsync({ token: out.value.restore });
							await refresh();
						},
					});
				} catch (error) {
					toast.failed(ta(`error.${saveError(error)}`));
				}
				await refresh();
			},
		}),
		[sheets, id, e, entry, del, restore, onClose, toast, ta, refresh],
	);

	return (
		<DetailPane
			actions={
				target ? (
					<PaneActions
						edit={() => sheets.open({ kind: "expense", mode: "edit", id })}
						editLabel={t("edit")}
						menu={
							<ActionMenu
								entity="expense"
								handlers={handlers}
								target={target}
							/>
						}
					/>
				) : null
			}
			closeLabel={phone ? t("back") : t("close")}
			label={e?.title ?? tr("amount")}
			onClose={onClose}
			phone={phone}
			title={
				e ? <PaneTitle category={e.category} title={e.title} /> : tr("amount")
			}
		>
			{!e ? <Waiting failed={q.isError} /> : <PersonalFacts e={e} />}
		</DetailPane>
	);
}

function PaneBody({
	target,
	onClose,
}: {
	target: PaneTarget;
	onClose: () => void;
}) {
	const phone = useIsMobile();
	// The id keys the pane, so a second expense starts clean.
	return target.kind === "personal" ? (
		<PersonalPane
			id={target.id}
			key={target.id}
			onClose={onClose}
			phone={phone}
		/>
	) : (
		<SharedPane
			id={target.id}
			key={target.id}
			onClose={onClose}
			phone={phone}
		/>
	);
}

function Host() {
	const { target, close } = usePaneRoute();
	if (!target) return null;
	return <PaneBody onClose={close} target={target} />;
}

/**
 * The expense detail pane host (T2): the shell mounts it beside the page, so
 * Activity, Projects, People and the palette share one pane. It reads the
 * URL (?expense= or ?shared=), so Back closes it.
 */
export function ExpensePaneHost() {
	return (
		<Suspense fallback={null}>
			<Host />
		</Suspense>
	);
}
