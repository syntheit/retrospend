import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { FieldError, TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * Add a person who has no account: a name and, if you want, an email. An
 * email that is the account of someone you already share with adds nothing
 * new, and the server says so. It changes no money, so there is no preview
 * and nothing to undo.
 */
export function AddPersonSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.people.add");
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	// Each opening starts empty.
	useEffect(() => {
		if (!visible) return;
		setName("");
		setEmail("");
		setFailed(false);
	}, [visible]);
	const trimmed = name.trim();
	const mail = email.trim();
	const mailBad = mail !== "" && !EMAIL.test(mail);
	const ready = trimmed !== "" && !mailBad && !saving;

	async function submit() {
		if (!api || !ready) return;
		setSaving(true);
		setFailed(false);
		try {
			const made = await api.people.create(
				{ id: newClientId(), name: trimmed, ...(mail ? { email: mail } : {}) },
				{ context: { idempotencyKey: newClientId() } },
			);
			announceEntryChange();
			toast.show({
				message: made.existing
					? t("existing", { name: made.name })
					: t("added", { name: made.name }),
			});
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet
			detents={["medium"]}
			footer={
				<Button
					busy={saving}
					disabled={!ready}
					label={saving ? t("saving") : t("save")}
					onPress={submit}
				/>
			}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<View style={{ gap: space[4] }}>
				<TextField
					autoCapitalize="words"
					label={t("name")}
					maxLength={191}
					onChangeText={setName}
					value={name}
				/>
				<View style={{ gap: space[1] }}>
					<TextField
						invalid={mailBad}
						keyboardType="email-address"
						label={t("email")}
						maxLength={255}
						onChangeText={setEmail}
						placeholder={t("emailPlaceholder")}
						value={email}
					/>
					{mailBad ? <FieldError>{t("emailInvalid")}</FieldError> : null}
				</View>
				{failed ? <FieldError>{t("error")}</FieldError> : null}
			</View>
		</Sheet>
	);
}
