import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { Note, SheetBody } from "@/features/budget/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Picker } from "@/ui/Picker";
import { Sheet } from "@/ui/Sheet";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import {
	type MethodInput,
	type PaymentMethod,
	preferred,
	type Visibility,
	withEdit,
	without,
} from "./source";

const VISIBILITIES: Visibility[] = ["PUBLIC", "FRIENDS_ONLY", "PAYMENT_ONLY"];

/**
 * One payment method: its label, number or handle, and who sees it. Prefer
 * moves it to the top; Remove asks once more. Every change sends the whole
 * list (the server replaces it) and says so in a toast.
 */
export function MethodSheet({
	method,
	all,
	visible,
	onClose,
	onDone,
}: {
	method: PaymentMethod;
	all: readonly PaymentMethod[];
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.settings.payment");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const [label, setLabel] = useState(method.label ?? "");
	const [identifier, setIdentifier] = useState(method.identifier ?? "");
	const [visibility, setVisibility] = useState<Visibility>(method.visibility);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const key = useRef(newClientId());

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the saved values with a fresh write key
	useEffect(() => {
		if (!visible) return;
		setLabel(method.label ?? "");
		setIdentifier(method.identifier ?? "");
		setVisibility(method.visibility);
		setConfirmRemove(false);
		setFailed(false);
		key.current = newClientId();
	}, [visible, method.id]);

	const changed =
		label.trim() !== (method.label ?? "") ||
		identifier.trim() !== (method.identifier ?? "") ||
		visibility !== method.visibility;

	async function send(methods: MethodInput[], message: string) {
		if (!api || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			await api["payment-methods"].replace(
				{ methods },
				{ context: { idempotencyKey: key.current } },
			);
			toast.show({ message });
			onDone();
			onClose();
		} catch {
			setFailed(true);
			key.current = newClientId();
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={method.label || method.type}
			visible={visible}
		>
			<SheetBody>
				<View style={{ gap: space[4] }}>
					<TextField
						autoCapitalize="sentences"
						label={t("label")}
						onChangeText={setLabel}
						value={label}
					/>
					<TextField
						label={t("identifier")}
						onChangeText={setIdentifier}
						value={identifier}
					/>
					<View style={{ gap: space[2] }}>
						<Note>{t("visibilityHint")}</Note>
						<Picker
							onChange={setVisibility}
							options={VISIBILITIES.map((value) => ({
								value,
								label: t(`visibility.${value}`),
							}))}
							value={visibility}
						/>
					</View>
					{failed ? <Note tone="attention">{t("saveError")}</Note> : null}
					<Button
						disabled={busy || !changed}
						label={busy ? tc("saving") : tc("save")}
						onPress={() =>
							send(
								withEdit(all, method.id, { label, identifier, visibility }),
								t("saved"),
							)
						}
					/>
					{method.rank === 1 ? null : (
						<Button
							disabled={busy}
							label={t("prefer")}
							onPress={() =>
								send(preferred(all, method.id), t("preferredToast"))
							}
							variant="outlined"
						/>
					)}
					{confirmRemove ? (
						<View style={{ gap: space[2] }}>
							<Note tone="attention">{t("removeBody")}</Note>
							<Button
								disabled={busy}
								label={t("removeConfirm")}
								onPress={() => send(without(all, method.id), t("removed"))}
								variant="outlined"
							/>
						</View>
					) : (
						<Button
							disabled={busy}
							label={t("remove")}
							onPress={() => setConfirmRemove(true)}
							variant="text"
						/>
					)}
				</View>
			</SheetBody>
		</Sheet>
	);
}
