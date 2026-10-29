import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note, SheetBody } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { Sheet } from "@/ui/Sheet";
import { useDayText } from "./ConfirmSheet";
import type { RecurringItem } from "./source";
import { useRecurringToast, useSkipUndo } from "./useRecurringToast";

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
	const api = useApi();
	const announce = useRecurringToast();
	const undoOf = useSkipUndo();
	const day = useDayText();
	const input = { id: item.id, dueAt: item.dueAt };
	const { idFor, reset } = useWriteIds(JSON.stringify(input));
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts with a fresh write id
	useEffect(() => {
		if (visible) reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: idFor("write"),
		preview: (body) => (api ? api.recurring.previewSkip(body) : noSession()),
		write: (body, key) =>
			api
				? api.recurring.skip(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", {
				title: item.title,
				date: day(item.nextAfter),
			}),
			undo: undoOf(out.undo),
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={["medium"]}
			onClose={onClose}
			title={t("title", { title: item.title })}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						<PreviewChanges
							lead={[
								{
									key: "next",
									label: tc("nextDue"),
									value: day(item.nextAfter),
								},
							]}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={t("submit")}
				>
					<Note>{t("body", { date: day(item.nextAfter) })}</Note>
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
