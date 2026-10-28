import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { Note, SheetBody } from "@/features/budget/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { useDayText } from "./ConfirmSheet";
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
}: {
	item: RecurringItem;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring.item");
	const { api } = useSession();
	const announce = useRecurringToast();
	const money = useMoneyText();
	const day = useDayText();
	const { space } = useTheme();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);

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
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet
			detents={["medium"]}
			onClose={onClose}
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
					<SwitchRow
						detail={t(item.autoPay ? "autoOnHint" : "autoOffHint")}
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
