import { useRef } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import { announceEntryChange } from "./events";
import { exclusive, flushEntries, takeFromOutbox } from "./queue";
import { releaseSent } from "./sentRetain";

export interface PendingTarget {
	clientId: string;
	kind: "expense" | "income" | "refund" | "transfer" | "payment";
	/** What the toast calls it. */
	title: string;
	/** It is gone: close the page. */
	onDeleted?: () => void;
}

/**
 * Delete an entry that only this phone has: it leaves the outbox, so the
 * server never hears of it. The same native alert as any delete (the title
 * only, no explainer) and the same Undo toast; Undo puts the entry back in
 * line and sends it again. No dry run: nothing on the server changes.
 */
export function useDeletePending(): (target: PendingTarget) => void {
	const t = useTranslations("mobile.composer.delete");
	const tc = useTranslations("mobile.common");
	const { api, local } = useSession();
	const toast = useToast();
	const busy = useRef(false);

	async function remove({ clientId, title, onDeleted }: PendingTarget) {
		if (!local || busy.current) return;
		busy.current = true;
		try {
			const entry = await takeFromOutbox(local.outbox, clientId);
			// Gone already: the server has it now, and a delete there is another action.
			if (!entry) {
				toast.show({ message: t("failed") });
				announceEntryChange();
				return;
			}
			releaseSent(clientId);
			announceEntryChange();
			toast.show({
				message: t("deleted", { title }),
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						await exclusive(local.outbox, () =>
							local.outbox.enqueue({
								clientId: entry.clientId,
								entity: entry.entity,
								kind: entry.kind,
								targetId: entry.targetId,
								baseVersion: entry.baseVersion,
								payload: entry.payload,
							}),
						);
						announceEntryChange();
						toast.show({ message: t("restored", { title }) });
						if (api) {
							await flushEntries(local.outbox, api).catch(() => undefined);
							announceEntryChange();
						}
					},
				},
			});
			onDeleted?.();
		} finally {
			busy.current = false;
		}
	}

	return function start(target) {
		const words =
			target.kind === "income" || target.kind === "refund"
				? t("titleIncome")
				: target.kind === "transfer"
					? t("titleTransfer")
					: t("title");
		showAlert(words, undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{ text: t("row"), style: "destructive", onPress: () => void remove(target) },
		]);
	};
}
