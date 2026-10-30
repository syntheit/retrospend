import { useEffect } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useDayText } from "./ConfirmSheet";
import type { RecurringItem } from "./source";
import { useDeleteUndo, useRecurringToast } from "./useRecurringToast";

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
	const api = useApi();
	const announce = useRecurringToast();
	const undoOf = useDeleteUndo();
	const day = useDayText();
	const { space } = useTheme();
	const input = { id: item.id };
	const { idFor, reset } = useWriteIds(JSON.stringify(input));
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts with a fresh write id
	useEffect(() => {
		if (visible) reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: idFor("write"),
		preview: (body) => (api ? api.recurring.previewDelete(body) : noSession()),
		write: (body, key) =>
			api
				? api.recurring.delete(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { title: item.title }),
			undo: undoOf(out.undo),
			onChanged: onDone,
		});
		onClose();
	}

	const busy = flow.committing;
	return (
		<Sheet
			detents={["medium"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						disabled={flow.status !== "ready" || busy}
						label={busy ? tc("saving") : t("submit")}
						onPress={() => void submit()}
						variant="danger"
					/>
				</>
			}
			onClose={onClose}
			title={t("title", { title: item.title })}
			visible={visible}
		>
			<View style={{ gap: space[4] }}>
				<Note>{t("body")}</Note>
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
					]}
					preview={flow.preview}
					status={flow.status}
				/>
				{flow.commitFailed ? <Note tone="attention">{t("error")}</Note> : null}
			</View>
		</Sheet>
	);
}
