import { useRef } from "react";

import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { deviceWrites } from "@/data/deviceWrites";
import { newClientId } from "@/data/ids";
import { showAlert } from "@/ui/alert";
import { useToast } from "@/ui/Toast";
import { previewDelete, runDelete } from "./deleteEntry";
import { announceEntryChange } from "./events";
import { queueExpenseChange, undoSaved } from "./queue";
import { undoWrite } from "./send";

/**
 * Delete one entry: the server's dry run first (R30), then the system alert
 * titled "Delete expense?" with Cancel and a destructive Delete, then the Undo
 * toast (R15). The alert has no message unless the delete reaches beyond this
 * entry: a split tells everyone on it, the server may warn that a debt would
 * be erased (then the button reads "Delete anyway"), or the delete may give no
 * Undo. One key per start, so a second tap replays the first delete.
 *
 * A detail page names its entry up front; a list calls the returned function
 * with the row's entry (`hookless`), so one hook serves every row.
 */
export interface DeleteTargetArgs {
	id: string;
	/** A split expense: its own routes and its warning. */
	shared: boolean;
	/** What the toast calls it. */
	title: string;
	/** It is gone: close the page or the composer. */
	onDeleted: () => void;
}

export function useDeleteEntry(
	base?: DeleteTargetArgs,
): (target?: Partial<DeleteTargetArgs>) => void {
	const t = useTranslations("mobile.composer.delete");
	const tc = useTranslations("mobile.common");
	const tt = useTranslations("mobile.composer.toast");
	const { api, local } = useSession();
	const toast = useToast();
	const busy = useRef(false);

	/**
	 * Dev flag: the delete is booked on the device and queued, not sent. The
	 * delete sender is PR10, so for now it waits in the outbox and Undo takes
	 * it back out. Null when the flag is off (the server delete runs as ever).
	 */
	async function queueDelete({
		id,
		shared,
		title,
		onDeleted,
	}: DeleteTargetArgs): Promise<boolean> {
		const writes = api && !shared ? deviceWrites(api) : null;
		if (!api || !local || !writes) return false;
		// The version the delete is checked against: the row as the server holds it
		// now. Offline this read fails and the device's last pulled version stands in.
		const opened = await api.expenses.get({ id }).then(
			(row) => row.updatedAt,
			() => null,
		);
		const queued = await queueExpenseChange({
			outbox: local.outbox,
			writes,
			change: { kind: "delete", id },
			opened,
		});
		if (queued.status !== "queued") {
			toast.show({
				message: tt(queued.status === "busy" ? "stillSending" : "notRead"),
			});
			return true;
		}
		announceEntryChange();
		toast.show({
			message: t("deleted", { title }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					const result = await undoSaved({
						outbox: local.outbox,
						api,
						clientId: queued.clientId,
					});
					announceEntryChange();
					toast.show({
						message:
							result === "undone" ? t("restored", { title }) : t("undoFailed"),
					});
				},
			},
		});
		onDeleted();
		return true;
	}

	async function remove(
		{ id, shared, title, onDeleted }: DeleteTargetArgs,
		key: string,
		confirmed: boolean,
	) {
		if (!api) return;
		if (await queueDelete({ id, shared, title, onDeleted })) return;
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

	return async function start(target?: Partial<DeleteTargetArgs>) {
		const now: DeleteTargetArgs = {
			id: "",
			shared: false,
			title: "",
			onDeleted: () => undefined,
			...base,
			...target,
		};
		const { id, shared } = now;
		if (!api || busy.current) return;
		busy.current = true;
		try {
			const out = await previewDelete(api, { id, shared });
			// Under the dev flag an offline dry run still reaches the confirm, with no
			// server diff, since the delete queues on the device. A refusal still stops.
			const queuesOffline =
				out.state.status === "offline" && !shared && deviceWrites(api) !== null;
			if (out.state.status !== "ready" && !queuesOffline) {
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
					onPress: () => void remove(now, key, warned),
				},
			]);
		} finally {
			busy.current = false;
		}
	};
}
