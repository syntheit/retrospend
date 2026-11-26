import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note } from "@/features/write/parts";
import { WriteSheet } from "@/features/write/WriteForm";
import { useDayText } from "./ConfirmSheet";
import {
	isSettled,
	previewSettle,
	type SettleAnswer,
	settleOnDevice,
} from "./deviceSettle";
import type { RecurringItem } from "./source";
import { useSettleDevice, useSettleToast } from "./useSettle";

/**
 * Skip one due recurring item: nothing is logged and the template moves to
 * its next date. The dry run names that date before Skip is on, the write
 * carries the item's due instant as its guard under one key, and the toast
 * puts the template back on the skipped date. Under the dev flag it is
 * booked on the device and queued like a confirm (see ConfirmSheet).
 */
export function SkipSheet({
	item,
	visible,
	onClose,
	onDone,
}: {
	item: RecurringItem;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring.skip");
	const tc = useTranslations("mobile.recurring.confirm");
	const tOffline = useTranslations("mobile.composer.changes");
	const device = useSettleDevice(item);
	const settled = useSettleToast();
	const day = useDayText();
	const toast = t("toast", { title: item.title, date: day(item.nextAfter) });
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges
					lead={[
						{ key: "next", label: tc("nextDue"), value: day(item.nextAfter) },
					]}
					message={
						device && status === "failed" ? tOffline("offline") : undefined
					}
					preview={preview}
					status={status}
				/>
			)}
			detent="medium"
			done={
				device
					? (out) => {
							if (isSettled(out))
								settled(out, {
									device,
									title: item.title,
									synced: toast,
									onChanged: onDone,
								});
						}
					: undefined
			}
			family="recurringSkip"
			input={{ id: item.id, dueAt: item.dueAt }}
			message={() => toast}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) =>
				device
					? previewSettle(device, "skip", body)
					: api.recurring.previewSkip(body)
			}
			queuesOffline={device !== null}
			submitLabel={t("submit")}
			title={t("title", { title: item.title })}
			visible={visible}
			write={(api, body, key): Promise<SettleAnswer | object> =>
				device
					? settleOnDevice({
							device,
							kind: "skip",
							body,
							clientId: key,
							item,
						})
					: api.recurring.skip(body, { context: { idempotencyKey: key } })
			}
		>
			<Note>{t("body", { date: day(item.nextAfter) })}</Note>
		</WriteSheet>
	);
}
