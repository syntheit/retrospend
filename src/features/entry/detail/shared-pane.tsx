"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { DetailPane } from "~/components/ui/detail-pane";
import { useToast } from "~/components/ui/toast";
import { saveError } from "~/features/activity/error-code";
import { useFixState } from "~/features/corrections/use-fix-state";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { useEntrySheets } from "../context";
import { PaneTitle, SharedFacts } from "./pane-facts";
import { PaneActions, type PaneProps, Waiting } from "./pane-parts";

/** A shared expense: facts, and what the corrections router allows. */
export function SharedPane({ id, onClose, phone }: PaneProps & { id: string }) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const ta = useTranslations("activity.actions");
	const toast = useToast();
	const sheets = useEntrySheets();
	const utils = api.useUtils();
	const { data: session } = useSession();
	const me = session?.user?.id;
	const q = api.sharedTransaction.getById.useQuery({ id });
	const fix = useFixState(id, me);
	const del = api.entry.shared.delete.save.useMutation();
	const restore = api.entry.shared.restore.save.useMutation();
	const tx = q.data;
	const lock = fix.lock;

	const target = useMemo<ExpenseTarget | null>(
		() =>
			tx
				? {
						id: tx.id,
						name: tx.description,
						mine: tx.canEdit || !!lock?.canCorrect,
						locked: tx.isLocked,
						reviewed: true,
						shared: true,
					}
				: null,
		[tx, lock?.canCorrect],
	);
	const handlers = useMemo<ActionHandlers<ExpenseTarget>>(
		() => ({
			edit: () => sheets.open({ kind: "shared", id }),
			...(lock?.canAskToFix
				? { askFix: () => sheets.open({ kind: "shared", id, start: "ask" }) }
				: {}),
			...(lock?.canCorrect
				? {
						correct: () =>
							sheets.open({ kind: "shared", id, start: "correct" }),
					}
				: {}),
			delete: async () => {
				if (!tx) return;
				try {
					const out = await del.mutateAsync({ id, keepForUndo: true });
					const stash = out.value.stash;
					onClose();
					toast.saved(ta("deleted", { name: tx.description }), {
						undo: stash
							? async () => {
									await restore.mutateAsync({ stash });
									await utils.expense.listV2.invalidate();
								}
							: undefined,
					});
				} catch (error) {
					toast.failed(ta(`error.${saveError(error)}`));
				}
				await utils.expense.listV2.invalidate();
			},
		}),
		[sheets, id, lock, tx, del, restore, onClose, toast, ta, utils],
	);

	return (
		<DetailPane
			actions={
				target ? (
					<PaneActions
						edit={() => sheets.open({ kind: "shared", id })}
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
			onClose={onClose}
			phone={phone}
			title={
				tx ? (
					<PaneTitle category={tx.category} title={tx.description} />
				) : (
					tr("amount")
				)
			}
		>
			{!tx ? <Waiting failed={q.isError} /> : <SharedFacts me={me} tx={tx} />}
		</DetailPane>
	);
}
