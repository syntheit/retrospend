import { Button } from "@expo/ui";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import {
	DEFAULT_SERVER,
	type ProbeResult,
	probeServer,
} from "@/lib/server-info";
import { useTheme } from "@/theme";
import { NativeHost } from "@/ui/NativeHost";
import { Screen } from "@/ui/Screen";

type Failure = Extract<ProbeResult, { ok: false }>["reason"] | "saveFailed";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

export default function ConnectScreen() {
	const t = useTranslations("mobile.connect");
	const { color, space, radius, size, type } = useTheme();
	const { connect } = useServerConnection();
	const [address, setAddress] = useState(new URL(DEFAULT_SERVER).host);
	const [checking, setChecking] = useState(false);
	const [failure, setFailure] = useState<Failure | null>(null);
	// A plain http server that answered; saved only after "Continue anyway".
	const [insecureUrl, setInsecureUrl] = useState<string | null>(null);

	async function save(baseUrl: string) {
		try {
			await connect(baseUrl);
		} catch {
			setFailure("saveFailed");
			setChecking(false);
		}
	}

	async function submit() {
		if (checking) return;
		setChecking(true);
		setFailure(null);
		setInsecureUrl(null);
		const result = await probeServer(address, APP_VERSION);
		if (!result.ok) {
			setFailure(result.reason);
			setChecking(false);
		} else if (result.insecure) {
			setInsecureUrl(result.baseUrl);
			setChecking(false);
		} else {
			await save(result.baseUrl);
		}
	}

	function continueInsecure() {
		if (!insecureUrl || checking) return;
		setChecking(true);
		save(insecureUrl);
	}

	function edit(text: string) {
		setAddress(text);
		setInsecureUrl(null);
	}

	const small = { fontSize: type.small.size };
	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					headerLargeTitle: Platform.OS === "ios",
					headerShadowVisible: false,
					title: t("title"),
				}}
			/>
			<Screen>
				<Text
					style={{
						color: color.fg2,
						fontSize: type.body.size,
						lineHeight: type.body.size * type.body.lineHeight,
					}}
				>
					{t("intro")}
				</Text>
				<View style={{ gap: space[2] }}>
					<Text style={[small, { color: color.fg }]}>{t("urlLabel")}</Text>
					<TextInput
						accessibilityLabel={t("urlLabel")}
						autoCapitalize="none"
						autoComplete="url"
						autoCorrect={false}
						editable={!checking}
						inputMode="url"
						keyboardType="url"
						onChangeText={edit}
						onSubmitEditing={submit}
						returnKeyType="go"
						style={{
							minHeight: size.touchMin.phone,
							paddingHorizontal: space[3],
							borderRadius: radius.ctl,
							borderWidth: 1,
							borderColor: failure ? color.danger : color.lineStrong,
							backgroundColor: color.surface,
							color: color.fg,
							fontSize: type.section.size,
						}}
						textContentType="URL"
						value={address}
					/>
					{failure ? (
						<Text
							accessibilityLiveRegion="polite"
							accessibilityRole="alert"
							style={[small, { color: color.danger }]}
						>
							{t(failure)}
						</Text>
					) : null}
					{insecureUrl ? (
						<Text
							accessibilityLiveRegion="polite"
							accessibilityRole="alert"
							style={[small, { color: color.attentionText }]}
						>
							{t("insecureWarning")}
						</Text>
					) : null}
				</View>
				<NativeHost>
					{insecureUrl ? (
						<Button
							disabled={checking}
							label={t("continueAnyway")}
							onPress={continueInsecure}
							variant="outlined"
						/>
					) : (
						<Button
							disabled={checking}
							label={checking ? t("checking") : t("submit")}
							onPress={submit}
						/>
					)}
				</NativeHost>
			</Screen>
		</>
	);
}
