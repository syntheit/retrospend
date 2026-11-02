import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note } from "@/features/write/parts";
import { WriteSheet } from "@/features/write/WriteForm";
import { useDayText } from "./ConfirmSheet";
import type { RecurringItem } from "./source";

/**
 * Skip one due recurring item: nothing is logged and the template moves to
 * its next date. The dry run names that date before Skip is on, the write
 * carries the item's due instant as its guard under one key, and the toast
 * puts the template back on the skipped date.
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
	const day = useDayText();
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges
					lead={[
						{ key: "next", label: tc("nextDue"), value: day(item.nextAfter) },
					]}
					preview={preview}
					status={status}
				/>
			)}
			detent="medium"
			family="recurringSkip"
			input={{ id: item.id, dueAt: item.dueAt }}
			message={() =>
				t("toast", { title: item.title, date: day(item.nextAfter) })
			}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.recurring.previewSkip(body)}
			submitLabel={t("submit")}
			title={t("title", { title: item.title })}
			visible={visible}
			write={(api, body, key) =>
				api.recurring.skip(body, { context: { idempotencyKey: key } })
			}
		>
			<Note>{t("body", { date: day(item.nextAfter) })}</Note>
		</WriteSheet>
	);
}
