import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { deviceFlagOn } from "@/data/deviceWrites";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note } from "@/features/write/parts";
import { WriteSheet } from "@/features/write/WriteForm";
import { useDayText } from "./ConfirmSheet";
import { templateHasWrites } from "./deviceTemplate";
import type { RecurringItem } from "./source";

/**
 * Delete a recurring template. The server's dry run of the exact delete comes
 * first; the sheet says what stops (the next due day and, when it is on,
 * auto-pay) and that the entries it already logged stay, before the danger
 * button deletes under one key. The toast has Undo, which brings the template
 * back with its schedule (R30, R15). It stays online under the dev flag too:
 * while this phone holds a write to the template that no pull has shown back,
 * it says "Sync first" and deletes nothing.
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
	// Under the flag the phone's own outbox is read whether or not the engine
	// runs yet, and one that cannot be read counts as a write waiting. Income is
	// never queued, so it has nothing to wait for.
	const { local } = useSession();
	const guarded = item.direction === "out" && deviceFlagOn();
	const outbox = local?.outbox ?? null;
	const [syncFirst, setSyncFirst] = useState(false);
	useEffect(() => {
		setSyncFirst(false);
		if (!guarded || !visible) return;
		let live = true;
		void templateHasWrites(outbox, item.id).then(
			(waiting) => live && setSyncFirst(waiting),
		);
		return () => {
			live = false;
		};
	}, [guarded, outbox, visible, item.id]);
	return (
		<WriteSheet
			changes={({ preview, status }) =>
				syncFirst ? (
					<Note tone="attention">{t("syncFirst")}</Note>
				) : (
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
				)
			}
			destructive={{
				label: t(item.direction === "in" ? "submitIn" : "submit"),
				busyLabel: tc("deleting"),
			}}
			detent="medium"
			error={t("error")}
			family="recurringDelete"
			input={syncFirst ? null : { id: item.id }}
			message={() => t("toast", { title: item.title })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.recurring.previewDelete(body)}
			title={t("title", { title: item.title })}
			visible={visible}
			write={async (api, body, key) => {
				// Checked again at the write: an entry may have been queued since the sheet opened.
				if (guarded && (await templateHasWrites(outbox, body.id))) {
					setSyncFirst(true);
					throw new Error("Sync first");
				}
				return api.recurring.delete(body, { context: { idempotencyKey: key } });
			}}
		/>
	);
}
