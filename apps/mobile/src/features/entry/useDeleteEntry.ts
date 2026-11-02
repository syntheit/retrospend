import { useRef } from "react";

import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import { previewDelete, runDelete } from "./deleteEntry";
import { announceEntryChange } from "./events";
import { undoWrite } from "./send";

/**
 * Delete one entry: the server's dry run first (R30), then the system alert
 * titled "Delete expense?" with Cancel and a destructive Delete, then the Undo
 * toast (R15). The alert has no message unless the delete reaches beyond this
 * entry: a split tells everyone on it, the server may warn that a debt would
 * be erased (then the button reads "Delete anyway"), or the delete may give no
 * Undo. One key per start, so a second tap replays the first delete.
 */
export function useDeleteEntry({
	id,
	shared,
	title,
	onDeleted,
}: {
	id: string;
	/** A split expense: its own routes and its warning. */
	shared: boolean;
	/** What the toast calls it. */
	title: string;
	/** It is gone: close the page or the composer. */
	onDeleted: () => void;
}): () => void {
	const t = useTranslations("mobile.composer.delete");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const busy = useRef(false);

	async function remove(key: string, confirmed: boolean) {
		if (!api) return;
		const outcome = await runDelete(api, { id, shared }, key, confirmed);
		if (outcome.status !== "deleted") {
			toast.show({ message: t("failed") });
			return;
		}
		announceEntryChange();
		const { undo } = outcome;
		toast.show({
			message: t("deleted", { title }),
			undo: undo
				? {
						label: tc("undo"),
						onUndo: async () => {
							const ok = await undoWrite(api, undo, newClientId()).then(
								() => true,
								() => false,
							);
							announceEntryChange();
							toast.show({
								message: ok ? t("restored", { title }) : t("undoFailed"),
							});
						},
					}
				: undefined,
		});
		onDeleted();
	}

	return async function start() {
		if (!api || busy.current) return;
		busy.current = true;
		try {
			const out = await previewDelete(api, { id, shared });
			if (out.state.status !== "ready") {
				toast.show({ message: t("failed") });
				return;
			}
			const key = newClientId();
			const warned = out.warning !== null;
			const message =
				out.warning ??
				(!out.undoable ? t("noUndo") : shared ? t("sharedEffect") : undefined);
			showAlert(t("title"), message, [
				{ text: tc("cancel"), style: "cancel" },
				{
					text: warned ? t("anyway") : t("row"),
					style: "destructive",
					onPress: () => void remove(key, warned),
				},
			]);
		} finally {
			busy.current = false;
		}
	};
}
