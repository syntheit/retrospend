import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { deviceWrites } from "@/data/deviceWrites";
import { newClientId } from "@/data/ids";
import { useToast } from "@/ui/Toast";
import type { PendingWrite } from "./draft";
import { saveExpenseEdit } from "./edit";
import { announceEntryChange } from "./events";
import {
	queueExpenseChange,
	type SaveOutcome,
	saveEntry,
	takeFromOutbox,
	undoSaved,
} from "./queue";
import { undoWrite } from "./send";
import type { EntryForm } from "./useEntryForm";

/**
 * Add and Save: an add goes through the outbox (it waits on the phone when
 * the server can not be reached), an edit is sent at once and never queued.
 * Both end in a toast with Undo (R15). A retry of the same edit body keeps
 * its idempotency key, so a lost answer replays instead of writing twice.
 */
export function useEntrySave({
	form,
	write,
	blocked,
	replaceId,
	onDone,
}: {
	form: EntryForm;
	write: PendingWrite | null;
	blocked: boolean;
	/** A waiting entry this add replaces (its client id). */
	replaceId?: string;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const toast = useToast();
	const { api, local } = useSession();
	const [busy, setBusy] = useState(false);

	// One key per edit body, kept across retries of the same body (R30).
	const editKey = useRef({ body: "", key: "" });
	function keyFor(body: string) {
		if (editKey.current.body !== body) {
			editKey.current = { body, key: newClientId() };
		}
		return editKey.current.key;
	}

	/**
	 * Dev flag: the edit is booked on the device and queued, not sent. The
	 * update sender is PR10, so for now it waits in the outbox and Undo takes
	 * it back out.
	 */
	async function queueEdit(): Promise<boolean> {
		const writes =
			write?.entity === "expenses" && api ? deviceWrites(api) : null;
		if (!write || !api || !local || !writes) return false;
		setBusy(true);
		const queued = await queueExpenseChange({
			outbox: local.outbox,
			writes,
			change: { kind: "update", body: write.body },
			opened: form.expense.editing?.updatedAt ?? null,
		}).finally(() => setBusy(false));
		if (queued.status !== "queued") {
			toast.show({
				message: t(
					queued.status === "busy" ? "toast.stillSending" : "toast.notRead",
				),
			});
			return true;
		}
		announceEntryChange();
		toast.show({
			message: t("toast.queued", { title: write.label }),
			undo: {
				label: t("undo"),
				onUndo: async () => {
					const result = await undoSaved({
						outbox: local.outbox,
						api,
						clientId: queued.clientId,
					});
					announceEntryChange();
					toast.show({
						message:
							result === "undone"
								? t("toast.undone", { title: write.label })
								: t("toast.undoFailed"),
					});
				},
			},
		});
		onDone();
		return true;
	}

	async function saveEdit() {
		if (!write || !api || busy || blocked) return;
		if (await queueEdit()) return;
		setBusy(true);
		const outcome = await saveExpenseEdit(
			api,
			write,
			keyFor(JSON.stringify(write.body)),
		).finally(() => setBusy(false));
		if (outcome.status !== "saved") {
			toast.show({
				message:
					outcome.status === "offline"
						? t("toast.editOffline")
						: t("toast.editRefused"),
			});
			return;
		}
		announceEntryChange();
		const { undo } = outcome;
		toast.show({
			message: t("toast.edited", { title: write.label }),
			undo: {
				label: t("undo"),
				onUndo: async () => {
					const ok = await undoWrite(api, undo, newClientId()).then(
						() => true,
						() => false,
					);
					announceEntryChange();
					toast.show({
						message: ok
							? t("toast.restored", { title: write.label })
							: t("toast.undoFailed"),
					});
				},
			},
		});
		onDone();
	}

	function showSaved(outcome: SaveOutcome, title: string, onUndo: () => void) {
		const message =
			outcome.status === "synced"
				? t("toast.added", { title })
				: outcome.status === "queued"
					? t("toast.queued", { title })
					: t("toast.parked", { title });
		const undoable =
			outcome.status === "queued" ||
			(outcome.status === "synced" && outcome.undo !== null);
		toast.show({
			message,
			undo: undoable ? { label: t("undo"), onUndo } : undefined,
		});
	}

	async function add() {
		form.setTried(true);
		if (form.editing) return saveEdit();
		if (!write || !api || !local || busy || blocked) return;
		setBusy(true);
		let outcome: SaveOutcome;
		try {
			// Editing a waiting entry: the old write leaves the outbox first. If a
			// flush sent it meanwhile the server has it, and this edit would not
			// replace anything: say so and leave it to Activity.
			if (
				replaceId &&
				(await takeFromOutbox(
					local.outbox,
					replaceId,
					deviceWrites(api) !== null,
				)) === null
			) {
				toast.show({ message: t("toast.editSynced") });
				announceEntryChange();
				onDone();
				return;
			}
			outcome = await saveEntry({ outbox: local.outbox, api, write });
		} finally {
			setBusy(false);
		}
		announceEntryChange();
		const clientId = String(write.body.id);
		showSaved(outcome, write.label, async () => {
			const result = await undoSaved({ outbox: local.outbox, api, clientId });
			announceEntryChange();
			toast.show({
				message:
					result === "undone"
						? t("toast.undone", { title: write.label })
						: t("toast.undoFailed"),
			});
		});
		form.setDrafts(form.fresh());
		form.setTried(false);
		form.setStep("quick");
		onDone();
	}

	return { add, busy };
}
