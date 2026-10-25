import { Button } from "@expo/ui";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import type { PersonIdentity } from "@/features/people/source";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { NativeHost } from "@/ui/NativeHost";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import { PreviewList } from "./PreviewList";
import type { PaymentPreview } from "./plan";

/**
 * Confirming a payment someone says they made to you: what it changes and
 * what it does not (the server's dry run of the confirm), then Confirm, then
 * a toast that undoes it. The amount and date are the payer's, as sent.
 */
export function ConfirmSheet({
	person,
	payment,
	visible,
	onClose,
	onDone,
}: {
	person: PersonIdentity;
	payment: { id: string; amount: { minor: number; currency: string } };
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.settle");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const [preview, setPreview] = useState<PaymentPreview | null>(null);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);
	const key = useRef(newClientId());
	const first = person.name.split(/\s+/)[0] ?? person.name;

	useEffect(() => {
		if (!visible || !api) return;
		let cancelled = false;
		key.current = newClientId();
		setPreview(null);
		setFailed(false);
		api.payments
			.previewConfirm({ id: payment.id })
			.then((result) => !cancelled && setPreview(result))
			.catch(() => !cancelled && setFailed(true));
		return () => {
			cancelled = true;
		};
	}, [visible, api, payment.id]);

	async function confirm() {
		if (!api || busy) return;
		setBusy(true);
		try {
			const result = await api.payments.confirm(
				{ id: payment.id },
				{ context: { idempotencyKey: key.current } },
			);
			onClose();
			onDone();
			toast.show({
				message: t("confirmed"),
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						try {
							await api.payments.undo(
								{ token: result.undo },
								{ context: { idempotencyKey: newClientId() } },
							);
							toast.show({ message: t("confirmUndone") });
							onDone();
						} catch {
							toast.show({ message: t("undoError") });
						}
					},
				},
			});
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("confirmTitle", { name: first })}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
			>
				<Text
					style={{
						color: color.fg,
						fontSize: type.title.size,
						fontVariant: ["tabular-nums"],
						fontWeight: "600",
					}}
				>
					{money(payment.amount)}
				</Text>
				{preview ? (
					<PreviewList name={first} preview={preview} />
				) : (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{failed ? t("previewError") : t("checking")}
					</Text>
				)}
				<NativeHost>
					<Button
						label={busy ? t("recording") : t("confirm")}
						onPress={preview && !busy ? confirm : undefined}
					/>
				</NativeHost>
			</ScrollView>
		</Sheet>
	);
}
