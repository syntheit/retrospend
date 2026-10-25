import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import type { Profile } from "./source";

function Field({
	label,
	value,
	onChangeText,
	prefix,
	invalid,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	prefix?: string;
	invalid?: boolean;
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<Text style={{ color: color.fg2, fontSize: type.small.size }}>
				{label}
			</Text>
			<View
				style={{
					minHeight: size.moneyInput.phone,
					flexDirection: "row",
					alignItems: "center",
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: invalid ? color.danger : color.lineStrong,
					backgroundColor: color.surface,
				}}
			>
				{prefix ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{prefix}
					</Text>
				) : null}
				<TextInput
					accessibilityLabel={label}
					autoCapitalize="none"
					autoCorrect={false}
					onChangeText={onChangeText}
					style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
					value={value}
				/>
			</View>
		</View>
	);
}

/**
 * Name and username. Only what changed is sent; the server answers the
 * saved profile. Email and password changes need the web (they need your
 * password and a confirmation link).
 */
export function ProfileSheet({
	profile,
	visible,
	onClose,
	onSaved,
}: {
	profile: Profile;
	visible: boolean;
	onClose: () => void;
	onSaved: () => void;
}) {
	const t = useTranslations("mobile.settings");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { color, space, type } = useTheme();
	const [name, setName] = useState(profile.name);
	const [username, setUsername] = useState(profile.username);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const key = useRef(newClientId());

	// Each opening starts from the saved values with a fresh write key.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the trigger
	useEffect(() => {
		if (!visible) return;
		setName(profile.name);
		setUsername(profile.username);
		setFailed(false);
		key.current = newClientId();
	}, [visible]);

	const nameOk = name.trim().length > 0;
	const userOk = /^[a-zA-Z0-9]{1,50}$/.test(username);
	const changed = name !== profile.name || username !== profile.username;

	async function save() {
		if (!api || busy || !nameOk || !userOk || !changed) return;
		setBusy(true);
		setFailed(false);
		try {
			await api.profile.update(
				{
					...(name !== profile.name ? { name } : {}),
					...(username !== profile.username ? { username } : {}),
				},
				{ context: { idempotencyKey: key.current } },
			);
			onClose();
			onSaved();
			toast.show({ message: t("saved") });
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
			title={t("profile.edit")}
			visible={visible}
		>
			<View style={{ gap: space[4] }}>
				<Field
					invalid={!nameOk}
					label={t("profile.name")}
					onChangeText={setName}
					value={name}
				/>
				<Field
					invalid={!userOk}
					label={t("profile.username")}
					onChangeText={setUsername}
					prefix="@"
					value={username}
				/>
				{userOk ? null : (
					<Text
						accessibilityRole="alert"
						style={{ color: color.danger, fontSize: type.small.size }}
					>
						{t("profile.usernameRule")}
					</Text>
				)}
				{failed ? (
					<Text
						accessibilityRole="alert"
						style={{ color: color.attentionText, fontSize: type.body.size }}
					>
						{t("profile.error")}
					</Text>
				) : null}
				<Button
					disabled={busy || !nameOk || !userOk || !changed}
					label={busy ? tc("saving") : tc("save")}
					onPress={save}
				/>
			</View>
		</Sheet>
	);
}
