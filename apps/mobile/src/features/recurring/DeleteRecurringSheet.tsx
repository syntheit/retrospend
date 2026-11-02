import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { WriteSheet } from "@/features/write/WriteForm";
import { useDayText } from "./ConfirmSheet";
import type { RecurringItem } from "./source";

/**
 * Delete a recurring template. The server's dry run of the exact delete comes
 * first; the sheet says what stops (the next due day and, when it is on,
 * auto-pay) and that the entries it already logged stay, before the danger
 * button deletes under one key. The toast has Undo, which brings the template
 * back with its schedule (R30, R15).
 */
export function DeleteRecurringSheet({
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
	const t = useTranslations("mobile.recurring.delete");
	const tc = useTranslations("mobile.common");
	const day = useDayText();
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges
					lead={[
						{
							key: "future",
							label: t("future"),
							value: t("futureValue", { date: day(item.next) }),
						},
						...(item.autoPay
							? [
									{
										key: "autoPay",
										label: t("autoPay"),
										value: t("autoPayValue"),
									},
								]
							: []),
						// What does not change is said too (R7).
						{ key: "logged", label: t("logged"), value: t("loggedStays") },
					]}
					preview={preview}
					status={status}
				/>
			)}
			destructive={{
				label: t(item.direction === "in" ? "submitIn" : "submit"),
				busyLabel: tc("deleting"),
			}}
			detent="medium"
			error={t("error")}
			family="recurringDelete"
			input={{ id: item.id }}
			message={() => t("toast", { title: item.title })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.recurring.previewDelete(body)}
			title={t("title", { title: item.title })}
			visible={visible}
			write={(api, body, key) =>
				api.recurring.delete(body, { context: { idempotencyKey: key } })
			}
		/>
	);
}
