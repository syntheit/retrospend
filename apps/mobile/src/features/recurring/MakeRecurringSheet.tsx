import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { ActivityItem } from "@/features/activity/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { spendKey, useWriteIds } from "@/features/write/useMoneyWrite";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useDayText } from "./ConfirmSheet";
import { createFromExpense, nextMonthly, templateBody } from "./makeRecurring";
import { useRecurringToast } from "./useRecurringToast";

/**
 * Makes an expense repeat every month. It says what it will do and what it
 * will not (the template is new, auto-pay is off, no entry and no total
 * changes) before the button, and the toast that follows undoes it by
 * deleting the template (R30, R15).
 */
export function MakeRecurringSheet({
	item,
	visible,
	onClose,
	onDone,
}: {
	item: ActivityItem;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring.make");
	const { api } = useSession();
	const announce = useRecurringToast();
	const money = useMoneyText();
	const day = useDayText();
	const { space } = useTheme();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	// One key per body: a Retry after a lost answer replays the first create.
	// A confirmed create spends its key, so the next one gets a fresh key.
	const { idFor } = useWriteIds(
		visible ? JSON.stringify(templateBody(item)) : null,
	);

	async function submit() {
		if (!api || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			const key = idFor("create");
			const made = await createFromExpense(api, item, key);
			spendKey(key);
			announce({
				message: t("toast", { title: item.title }),
				undo: async () => {
					await api.recurring.delete(
						{ id: made.id },
						{ context: { idempotencyKey: newClientId() } },
					);
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
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<View style={{ gap: space[4] }}>
					<Note>
						{t("body", {
							title: item.title,
							amount: money(item.amount),
							date: day(nextMonthly(item.date)),
						})}
					</Note>
					<Note>{t("stays")}</Note>
					{failed ? <Note tone="attention">{t("error")}</Note> : null}
					<Button
						disabled={busy}
						label={busy ? t("saving") : t("submit")}
						onPress={submit}
					/>
				</View>
			</SheetBody>
		</Sheet>
	);
}
