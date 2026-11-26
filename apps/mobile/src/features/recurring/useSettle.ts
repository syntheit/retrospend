import { useCallback, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { deviceWrites } from "@/data/deviceWrites";
import { transportFor } from "@/data/transport";
import { announceEntryChange } from "@/features/entry/events";
import { isOfflineError } from "@/features/entry/preview";
import { undoSaved } from "@/features/entry/queue";
import { useToast } from "@/ui/Toast";
import type { SettleAnswer, SettleDevice } from "./deviceSettle";
import type { RecurringItem } from "./source";

// The hooks of the device settle (deviceSettle.ts): which sheets use it, and
// the toast that ends it.

/**
 * The device's write side for one item, or null: the flag is off, no engine
 * runs yet, nothing is signed in, or the item is income (income is confirmed
 * online until the device books it).
 */
export function useSettleDevice(item: RecurringItem): SettleDevice | null {
	const { api, local } = useSession();
	if (!api || !local || item.direction !== "out") return null;
	const writes = deviceWrites(api);
	return writes ? { api, outbox: local.outbox, writes } : null;
}

/**
 * Whether the last dry run failed because the server could not be reached.
 * Only then does Save wait on the phone and the sheet say so: any other
 * failure (a 5xx, a timeout while online) keeps the sheet's error line and
 * Save off, as with the flag off. `track` wraps the sheet's dry run.
 */
export function useOfflineDryRun() {
	const [offline, setOffline] = useState(false);
	const track = useCallback(
		<T>(run: Promise<T>): Promise<T> =>
			run.then(
				(value) => {
					setOffline(false);
					return value;
				},
				(error: unknown) => {
					setOffline(isOfflineError(error));
					throw error;
				},
			),
		[],
	);
	return { offline, track };
}

/**
 * The toast that ends a device settle: what happened, and Undo while it can
 * be taken back (out of the outbox, or through the server once it was sent).
 */
export function useSettleToast() {
	const t = useTranslations("mobile.recurring.device");
	const tq = useTranslations("mobile.composer.toast");
	const tc = useTranslations("mobile.common");
	const tw = useTranslations("mobile.budget.write");
	const toast = useToast();
	return useCallback(
		(
			answer: SettleAnswer,
			done: {
				device: SettleDevice;
				title: string;
				/** The sentence for a settle the server has. */
				synced: string;
				onChanged: () => void;
			},
		) => {
			const { device, title } = done;
			if (
				answer.settled !== "synced" &&
				answer.settled !== "queued" &&
				answer.settled !== "parked"
			) {
				toast.show({ message: t(answer.settled, { title }) });
				return;
			}
			announceEntryChange();
			done.onChanged();
			const { clientId } = answer;
			const undoable =
				answer.settled === "queued" ||
				(answer.settled === "synced" && answer.undo !== null);
			toast.show({
				message:
					answer.settled === "synced"
						? done.synced
						: answer.settled === "queued"
							? tq("queued", { title })
							: t("parked", { title }),
				undo: undoable
					? {
							label: tc("undo"),
							onUndo: async () => {
								const result = await undoSaved({
									outbox: device.outbox,
									api: device.api,
									transport: transportFor(device.api),
									clientId,
								});
								announceEntryChange();
								toast.show({
									message:
										result === "undone" ? tw("undone") : tq("undoFailed"),
								});
								if (result === "undone") done.onChanged();
							},
						}
					: undefined,
			});
		},
		[t, tq, tc, tw, toast],
	);
}
