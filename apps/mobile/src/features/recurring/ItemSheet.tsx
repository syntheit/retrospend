import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { menuOf } from "@/ui/actionRegistry";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { useDayText } from "./ConfirmSheet";
import { RECURRING_ACTIONS } from "./recurringActions";
import type { RecurringItem } from "./source";
import { useRecurringToast } from "./useRecurringToast";

/**
 * One recurring template that is not due: when it comes next, the auto-pay
 * switch and Pause or Resume. These change the template only (no money
 * moves), and each ends in a toast that puts it back.
 */
export function ItemSheet({
	item,
	visible,
	onClose,
	onDone,
	onDelete,
}: {
	item: RecurringItem;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
	/** Opens the delete sheet, which says what stops before anything goes. */
	onDelete: () => void;
}) {
	const t = useTranslations("mobile.recurring.item");
	const tr = useTranslations("mobile.recurring");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const announce = useRecurringToast();
	const money = useMoneyText();
	const day = useDayText();
	const { space } = useTheme();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [editing, setEditing] = useState(false);

	function close() {
		setEditing(false);
		onClose();
	}

	async function change(patch: { paused?: boolean; autoPay?: boolean }) {
		if (!api || busy) return;
		setBusy(true);
		setFailed(false);
		const write = (body: { paused?: boolean; autoPay?: boolean }) =>
			api.recurring.update(
				{ id: item.id, ...body },
				{ context: { idempotencyKey: newClientId() } },
			);
		try {
			await write(patch);
			const back =
				patch.paused !== undefined
					? { paused: item.paused }
					: { autoPay: item.autoPay };
			const message =
				patch.paused === true
					? t("pausedToast", { title: item.title })
					: patch.paused === false
						? t("resumedToast", { title: item.title })
						: t(patch.autoPay ? "autoOnToast" : "autoOffToast", {
								title: item.title,
							});
			announce({
				message,
				undo: async () => {
					await write(back);
				},
				onChanged: onDone,
			});
			close();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	// A view shows the template's facts; the pencil opens what changes them.
	if (!editing) {
		return (
			<Sheet
				detents={["medium"]}
				edit={{ label: tc("edit"), onPress: () => setEditing(true) }}
				menu={{
					label: tc("more"),
					items: menuOf(
						["delete"],
						RECURRING_ACTIONS,
						{ confirm: "", skip: "", details: "", delete: t("delete") },
						{
							confirm: onDelete,
							skip: onDelete,
							details: onDelete,
							delete: onDelete,
						},
					),
				}}
				onClose={close}
				title={item.title}
				visible={visible}
			>
				<SheetBody>
					<View style={{ gap: space[4] }}>
						<Note>
							{t(item.paused ? "paused" : "next", {
								amount: money(item.amount),
								date: day(item.next),
							})}
						</Note>
						<Note>
							{[
								tr(`frequency.${item.frequency}`),
								tr(item.autoPay ? "autoPayOn" : "autoPayOff"),
							].join(" · ")}
						</Note>
					</View>
				</SheetBody>
			</Sheet>
		);
	}

	return (
		<Sheet
			detents={["medium"]}
			onClose={close}
			title={item.title}
			visible={visible}
		>
			<SheetBody>
				<View style={{ gap: space[4] }}>
					<SwitchRow
						disabled={busy}
						label={t("autoPay")}
						onChange={(autoPay) => change({ autoPay })}
						value={item.autoPay}
					/>
					{failed ? <Note tone="attention">{t("error")}</Note> : null}
					<Button
						disabled={busy}
						label={item.paused ? t("resume") : t("pause")}
						onPress={() => change({ paused: !item.paused })}
						variant="outlined"
					/>
				</View>
			</SheetBody>
		</Sheet>
	);
}
